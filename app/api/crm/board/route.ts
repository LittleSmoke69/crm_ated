import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { canAccessUser } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getConsultorsByManager } from '@/lib/utils/hierarchy';
import { fetchAllSupabasePages } from '@/lib/supabase/fetch-all-pages';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Kanban de gestão de clientes (sem loteria).
 * Fonte: crm_columns (estágios) + crm_leads (clientes) + crm_lead_stage (posição).
 */

const PAGE_SIZE = 1000;
/** PostgREST coloca o .in() na querystring; chunks grandes geram 414 no nginx. */
const IN_CHUNK = 80;

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

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
  canEditColumns: boolean;
  tenantId: string | null;
  teamUserIds: string[] | null;
};

async function getViewerContext(userId: string): Promise<ViewerContext> {
  const { data } = await supabaseServiceRole
    .from('profiles')
    .select('status, zaploto_id')
    .eq('id', userId)
    .maybeSingle();
  const status = String((data as { status?: string } | null)?.status ?? '').toLowerCase();
  const isAdmin = status === 'super_admin' || status === 'admin';
  const isGerente = status === 'gerente';
  const tenantId = ((data as { zaploto_id?: string | null } | null)?.zaploto_id ?? null) as string | null;
  let teamUserIds: string[] | null = null;
  if (isGerente) {
    const team = await getConsultorsByManager(userId);
    teamUserIds = team.map((c) => c.id);
  }
  return {
    status,
    canViewAll: isAdmin || isGerente,
    canEditColumns: isAdmin,
    tenantId,
    teamUserIds,
  };
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
    const targetUserId = req.nextUrl.searchParams.get('target_user_id') || req.nextUrl.searchParams.get('userId');

    const { data: columns } = await supabaseServiceRole
      .from('crm_columns')
      .select('id, key, title, color, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    let leadsFilter: {
      mode: 'eq' | 'in' | 'not_in' | 'gerente_scope' | 'none';
      values?: string[];
      gerenteId?: string;
    } = { mode: 'none' };

    if (viewer.status === 'gerente') {
      const teamIds = viewer.teamUserIds ?? [];
      if (targetUserId) {
        const allowed = await canAccessUser(userId, targetUserId);
        if (!allowed || (teamIds.length > 0 && !teamIds.includes(targetUserId))) {
          return errorResponse('Sem permissão para ver o kanban deste captador.', 403);
        }
        leadsFilter = { mode: 'eq', values: [targetUserId] };
      } else {
        // Paridade com /api/admin/crm/leads: pool do gerente (gerente_id) + leads dos captadores.
        leadsFilter = { mode: 'gerente_scope', values: teamIds, gerenteId: userId };
      }
    } else if (!viewer.canViewAll) {
      leadsFilter = { mode: 'eq', values: [userId] };
    } else if (viewer.status === 'admin') {
      if (viewer.tenantId) {
        const tenantUserIds = await getTenantUserIds(viewer.tenantId, { excludeSuperAdmin: true });
        if (tenantUserIds.length === 0) {
          return successResponse({
            columns: columns ?? [],
            clients: [],
            meta: { can_view_all: true, can_edit_columns: true, attendants: [], total_clients: 0 },
          });
        }
        leadsFilter = { mode: 'in', values: tenantUserIds };
      } else {
        const superAdminIds = await getSuperAdminUserIds();
        if (superAdminIds.length > 0) {
          leadsFilter = { mode: 'not_in', values: superAdminIds };
        }
      }
    }

    const { data: leads, error: leadsError } = await fetchAllSupabasePages<LeadRow>(
      async (from, to) => {
        let query = supabaseServiceRole
          .from('crm_leads')
          .select('external_id, user_id, name, last_name, phone, email')
          .order('created_at', { ascending: false })
          .order('external_id', { ascending: false })
          .range(from, to);

        if (leadsFilter.mode === 'eq' && leadsFilter.values?.[0]) {
          query = query.eq('user_id', leadsFilter.values[0]);
        } else if (leadsFilter.mode === 'gerente_scope' && leadsFilter.gerenteId) {
          const teamIds = (leadsFilter.values ?? []).filter(Boolean);
          if (teamIds.length > 0) {
            query = query.or(
              `gerente_id.eq.${leadsFilter.gerenteId},user_id.in.(${teamIds.join(',')})`
            );
          } else {
            query = query.eq('gerente_id', leadsFilter.gerenteId);
          }
        } else if (leadsFilter.mode === 'in' && leadsFilter.values?.length) {
          query = query.in('user_id', leadsFilter.values);
        } else if (leadsFilter.mode === 'not_in' && leadsFilter.values?.length) {
          query = query.not('user_id', 'in', `(${leadsFilter.values.join(',')})`);
        }

        const { data, error } = await query;
        return { data: (data as LeadRow[] | null) ?? null, error };
      },
      PAGE_SIZE
    );
    if (leadsError) return errorResponse(`Erro ao carregar clientes: ${leadsError.message}`, 500);

    const leadRows = leads ?? [];
    const externalIds = leadRows.map((l) => String(l.external_id));

    const stageMap = new Map<string, { column_key: string; position: number }>();
    for (const ids of chunkArray(externalIds, IN_CHUNK)) {
      const { data: stages, error: stagesError } = await fetchAllSupabasePages<{
        lead_external_id: string;
        user_id: string;
        column_key: string;
        position: number;
      }>(
        async (from, to) => {
          const { data, error } = await supabaseServiceRole
            .from('crm_lead_stage')
            .select('lead_external_id, user_id, column_key, position')
            .in('lead_external_id', ids)
            .order('lead_external_id', { ascending: true })
            .range(from, to);
          return { data, error };
        },
        PAGE_SIZE
      );
      if (stagesError) return errorResponse(`Erro ao carregar estágios: ${stagesError.message}`, 500);
      for (const s of stages ?? []) {
        stageMap.set(`${s.lead_external_id}:${s.user_id}`, {
          column_key: s.column_key,
          position: s.position,
        });
      }
    }

    const tagMap = new Map<string, { id: string; label: string; color: string }[]>();
    for (const ids of chunkArray(externalIds, IN_CHUNK)) {
      const { data: lt, error: tagsError } = await fetchAllSupabasePages<{
        lead_external_id: string;
        user_id: string;
        crm_tags: { id: string; label: string; color: string } | null;
      }>(
        async (from, to) => {
          const { data, error } = await supabaseServiceRole
            .from('crm_lead_tags')
            .select('lead_external_id, user_id, crm_tags(id, label, color)')
            .in('lead_external_id', ids)
            .order('lead_external_id', { ascending: true })
            .range(from, to);
          return { data: data as any, error };
        },
        PAGE_SIZE
      );
      if (tagsError) return errorResponse(`Erro ao carregar etiquetas: ${tagsError.message}`, 500);
      for (const row of lt ?? []) {
        if (!row.crm_tags) continue;
        const key = `${row.lead_external_id}:${row.user_id}`;
        const arr = tagMap.get(key) ?? [];
        arr.push({ id: row.crm_tags.id, label: row.crm_tags.label, color: row.crm_tags.color });
        tagMap.set(key, arr);
      }
    }

    const ownerIds = [...new Set(leadRows.map((l) => l.user_id).filter(Boolean))] as string[];
    const ownerNameById = new Map<string, string>();
    for (const ids of chunkArray(ownerIds, IN_CHUNK)) {
      const { data: owners } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email')
        .in('id', ids);
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
        can_edit_columns: viewer.canEditColumns,
        attendants,
        total_clients: clients.length,
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

// PATCH /api/crm/board — move um cliente de estágio (drag-and-drop) OU edita nome/telefone/e-mail
export async function PATCH(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const viewer = await getViewerContext(userId);
    const body = await req.json().catch(() => ({}));
    const leadExternalId = typeof body.lead_external_id === 'string' ? body.lead_external_id : String(body.lead_external_id ?? '');
    if (!leadExternalId) return errorResponse('Dados incompletos.', 400);

    const ownerUserId = typeof body.owner_user_id === 'string' && body.owner_user_id ? body.owner_user_id : userId;

    if (ownerUserId !== userId) {
      const allowed = await canAccessUser(userId, ownerUserId);
      if (!allowed) {
        return errorResponse('Sem permissão para alterar clientes de outro atendente.', 403);
      }
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

    // Edição de dados cadastrais (nome/telefone/e-mail) — sinalizada pela presença de qualquer um desses campos.
    const isInfoEdit = body.name !== undefined || body.phone !== undefined || body.email !== undefined;
    if (isInfoEdit) {
      const name = typeof body.name === 'string' ? body.name.trim() : undefined;
      if (name !== undefined && !name) return errorResponse('Nome é obrigatório.', 400);

      const updates: Record<string, unknown> = {};
      // Nome inteiro vai para a coluna `name`; zera `last_name` para não duplicar
      // o sobrenome antigo por trás de um nome completo novo (ver GET, que concatena os dois).
      if (name !== undefined) { updates.name = name; updates.last_name = null; }
      if (typeof body.phone === 'string') updates.phone = body.phone.trim() || null;
      if (typeof body.email === 'string') updates.email = body.email.trim() || null;

      const { error: updateError } = await supabaseServiceRole
        .from('crm_leads')
        .update(updates)
        .eq('external_id', leadExternalId)
        .eq('user_id', ownerUserId);
      if (updateError) return errorResponse(`Erro ao salvar cliente: ${updateError.message}`, 500);

      return successResponse({ ok: true });
    }

    // Mover de estágio (drag-and-drop)
    const columnKey = typeof body.column_key === 'string' ? body.column_key : '';
    if (!columnKey) return errorResponse('Dados incompletos.', 400);
    const position = Number.isFinite(body.position) ? Number(body.position) : 0;

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
