import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * Kanban de gestão de clientes (sem loteria).
 * Fonte: crm_columns (estágios) + crm_leads (clientes) + crm_lead_stage (posição).
 */

type LeadRow = {
  external_id: number;
  user_id: string | null;
  name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
};

type ViewerContext = {
  status: string;
  canViewAll: boolean;
  tenantId: string | null;
};

async function getViewerContext(userId: string): Promise<ViewerContext> {
  const { data } = await supabaseServiceRole
    .from('profiles')
    .select('status, zaploto_id')
    .eq('id', userId)
    .maybeSingle();
  const status = String((data as { status?: string } | null)?.status ?? '').toLowerCase();
  const canViewAll = status === 'super_admin' || status === 'admin';
  const tenantId = ((data as { zaploto_id?: string | null } | null)?.zaploto_id ?? null) as string | null;
  return { status, canViewAll, tenantId };
}

async function getTenantUserIds(tenantId: string, options?: { excludeSuperAdmin?: boolean }): Promise<string[]> {
  const { data } = await supabaseServiceRole
    .from('profiles')
    .select('id, status')
    .eq('zaploto_id', tenantId);
  return (data ?? [])
    .filter((row) => {
      if (!options?.excludeSuperAdmin) return true;
      return String((row as { status?: string }).status ?? '').toLowerCase() !== 'super_admin';
    })
    .map((row) => row.id as string);
}

async function getSuperAdminUserIds(): Promise<string[]> {
  const { data } = await supabaseServiceRole.from('profiles').select('id').eq('status', 'super_admin');
  return (data ?? []).map((row) => row.id as string);
}

// GET /api/crm/board — colunas + clientes com estágio atual
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const viewer = await getViewerContext(userId);

    const { data: columns } = await supabaseServiceRole
      .from('crm_columns')
      .select('id, key, title, color, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    let leadsQuery = supabaseServiceRole
      .from('crm_leads')
      .select('external_id, user_id, name, last_name, phone, email')
      .order('created_at', { ascending: false })
      .limit(2000);

    if (!viewer.canViewAll) {
      leadsQuery = leadsQuery.eq('user_id', userId);
    } else if (viewer.status === 'admin') {
      if (viewer.tenantId) {
        const tenantUserIds = await getTenantUserIds(viewer.tenantId, { excludeSuperAdmin: true });
        if (tenantUserIds.length === 0) {
          return successResponse({
            columns: columns ?? [],
            clients: [],
            meta: { can_view_all: true, attendants: [] },
          });
        }
        leadsQuery = leadsQuery.in('user_id', tenantUserIds);
      } else {
        const superAdminIds = await getSuperAdminUserIds();
        if (superAdminIds.length > 0) {
          leadsQuery = leadsQuery.not('user_id', 'in', `(${superAdminIds.join(',')})`);
        }
      }
    }

    const { data: leads } = await leadsQuery;

    const leadRows = (leads ?? []) as LeadRow[];
    const externalIds = leadRows.map((l) => String(l.external_id));

    const stageMap = new Map<string, { column_key: string; position: number }>();
    if (externalIds.length) {
      const { data: stages } = await supabaseServiceRole
        .from('crm_lead_stage')
        .select('lead_external_id, user_id, column_key, position')
        .in('lead_external_id', externalIds);
      for (const s of stages ?? []) {
        const row = s as { lead_external_id: string; user_id: string; column_key: string; position: number };
        stageMap.set(`${row.lead_external_id}:${row.user_id}`, { column_key: row.column_key, position: row.position });
      }
    }

    const tagMap = new Map<string, { id: string; label: string; color: string }[]>();
    if (externalIds.length) {
      const { data: lt } = await supabaseServiceRole
        .from('crm_lead_tags')
        .select('lead_external_id, user_id, crm_tags(id, label, color)')
        .in('lead_external_id', externalIds);
      for (const row of lt ?? []) {
        const r = row as { lead_external_id: string; user_id: string; crm_tags: { id: string; label: string; color: string } | null };
        if (!r.crm_tags) continue;
        const key = `${r.lead_external_id}:${r.user_id}`;
        const arr = tagMap.get(key) ?? [];
        arr.push({ id: r.crm_tags.id, label: r.crm_tags.label, color: r.crm_tags.color });
        tagMap.set(key, arr);
      }
    }

    const ownerIds = [...new Set(leadRows.map((l) => l.user_id).filter(Boolean))] as string[];
    const ownerNameById = new Map<string, string>();
    if (ownerIds.length > 0) {
      const { data: owners } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email')
        .in('id', ownerIds);
      for (const o of owners ?? []) {
        const row = o as { id: string; full_name?: string | null; email?: string | null };
        ownerNameById.set(row.id, row.full_name?.trim() || row.email?.trim() || row.id);
      }
    }

    const firstKey = (columns?.[0] as { key?: string } | undefined)?.key ?? 'novo';
    const clients = leadRows.map((l) => {
      const mapKey = `${l.external_id}:${l.user_id}`;
      const stage = stageMap.get(mapKey);
      const ownerId = l.user_id;
      return {
        external_id: String(l.external_id),
        owner_user_id: ownerId,
        owner_name: ownerId ? ownerNameById.get(ownerId) ?? null : null,
        name: [l.name, l.last_name].filter(Boolean).join(' ') || 'Sem nome',
        phone: l.phone ?? '',
        email: l.email ?? '',
        column_key: stage?.column_key ?? firstKey,
        position: stage?.position ?? 0,
        tags: tagMap.get(mapKey) ?? [],
      };
    });

    const attendants = ownerIds
      .map((id) => ({ id, name: ownerNameById.get(id) ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    return successResponse({
      columns: columns ?? [],
      clients,
      meta: {
        can_view_all: viewer.canViewAll,
        attendants,
      },
    });
  } catch (err) {
    return serverErrorResponse(err);
  }
}

// POST /api/crm/board — cria um cliente e o coloca no primeiro estágio
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return errorResponse('Nome é obrigatório.', 400);

    const externalId = Date.now();
    const { error: insErr } = await supabaseServiceRole.from('crm_leads').insert({
      external_id: externalId,
      user_id: userId,
      name,
      phone: typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null,
      email: typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null,
      status: 'novo',
    });
    if (insErr) return errorResponse(`Erro ao criar cliente: ${insErr.message}`, 500);

    let targetKey = typeof body.column_key === 'string' && body.column_key ? body.column_key : '';
    if (!targetKey) {
      const { data: col } = await supabaseServiceRole
        .from('crm_columns')
        .select('key')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .limit(1)
        .maybeSingle();
      targetKey = (col as { key?: string } | null)?.key ?? 'novo';
    }

    await supabaseServiceRole.rpc('crm_move_lead', {
      p_lead_external_id: String(externalId),
      p_user_id: userId,
      p_column_key: targetKey,
      p_position: 0,
      p_moved_by: userId,
    });

    return successResponse({
      external_id: String(externalId),
      owner_user_id: userId,
      owner_name: null,
      name,
      phone: typeof body.phone === 'string' ? body.phone.trim() : '',
      email: typeof body.email === 'string' ? body.email.trim() : '',
      column_key: targetKey,
      position: 0,
      tags: [],
    });
  } catch (err) {
    return serverErrorResponse(err);
  }
}

// PATCH /api/crm/board — move um cliente de estágio (drag-and-drop)
export async function PATCH(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const viewer = await getViewerContext(userId);
    const body = await req.json().catch(() => ({}));
    const leadExternalId = typeof body.lead_external_id === 'string' ? body.lead_external_id : String(body.lead_external_id ?? '');
    const columnKey = typeof body.column_key === 'string' ? body.column_key : '';
    if (!leadExternalId || !columnKey) return errorResponse('Dados incompletos.', 400);

    const ownerUserId = typeof body.owner_user_id === 'string' && body.owner_user_id ? body.owner_user_id : userId;
    const position = Number.isFinite(body.position) ? Number(body.position) : 0;

    if (!viewer.canViewAll && ownerUserId !== userId) {
      return errorResponse('Sem permissão para mover clientes de outro atendente.', 403);
    }

    if (viewer.canViewAll && viewer.status === 'admin' && viewer.tenantId) {
      const tenantUserIds = await getTenantUserIds(viewer.tenantId, { excludeSuperAdmin: true });
      if (!tenantUserIds.includes(ownerUserId)) {
        return errorResponse('Cliente fora do escopo do tenant.', 403);
      }
    }

    if (viewer.canViewAll && viewer.status === 'admin' && !viewer.tenantId) {
      const superAdminIds = await getSuperAdminUserIds();
      if (superAdminIds.includes(ownerUserId)) {
        return errorResponse('Sem permissão para alterar clientes de super admin.', 403);
      }
    }

    const { data: lead } = await supabaseServiceRole
      .from('crm_leads')
      .select('user_id')
      .eq('external_id', leadExternalId)
      .eq('user_id', ownerUserId)
      .maybeSingle();
    if (!lead) return errorResponse('Cliente não encontrado.', 404);

    const { error } = await supabaseServiceRole.rpc('crm_move_lead', {
      p_lead_external_id: leadExternalId,
      p_user_id: ownerUserId,
      p_column_key: columnKey,
      p_position: position,
      p_moved_by: userId,
    });
    if (error) return errorResponse(`Erro ao mover cliente: ${error.message}`, 500);

    return successResponse({ ok: true });
  } catch (err) {
    return serverErrorResponse(err);
  }
}
