import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';

const CAPTURE_STATUSES = ['pendente', 'em_contato', 'convertido', 'descartado'] as const;
const PAGE_SIZE_DEFAULT = 25;
const SCAN_PAGE = 1000;
const SCAN_MAX = 20000;

function normalizePhone(v: string | null | undefined): string {
  return String(v || '').replace(/\D/g, '');
}

/** Perfis do tenant (para escopo e para montar os selects de gerente/captador). */
async function getTenantProfiles(zaplotoId: string) {
  const { data } = await supabaseServiceRole
    .from('profiles')
    .select('id, full_name, email, status, enroller')
    .or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`);
  return data || [];
}

/**
 * Varre crm_leads do escopo (tenant) com os filtros básicos aplicados,
 * retornando linhas leves para paginação/duplicados em memória.
 */
async function scanLeads(params: {
  tenantUserIds: string[];
  zaplotoId: string;
  q?: string;
  captureStatus?: string;
  gerenteId?: string;
  captadorId?: string;
  fromIso?: string;
}) {
  const { tenantUserIds, zaplotoId, q, captureStatus, gerenteId, captadorId, fromIso } = params;
  const rows: any[] = [];
  let from = 0;
  while (rows.length < SCAN_MAX) {
    let query = supabaseServiceRole
      .from('crm_leads')
      .select('id, external_id, user_id, gerente_id, name, last_name, phone, email, capture_status, source, created_at, zaploto_id')
      .order('created_at', { ascending: false })
      .range(from, from + SCAN_PAGE - 1);

    // Escopo: leads de usuários do tenant OU pendentes (sem dono) do tenant/legado
    const idsList = tenantUserIds.join(',');
    query = query.or(
      `user_id.in.(${idsList}),and(user_id.is.null,zaploto_id.eq.${zaplotoId}),and(user_id.is.null,zaploto_id.is.null)`
    );

    if (captureStatus && CAPTURE_STATUSES.includes(captureStatus as any)) {
      query = query.eq('capture_status', captureStatus);
    }
    if (gerenteId) query = query.eq('gerente_id', gerenteId);
    if (captadorId) query = query.eq('user_id', captadorId);
    if (fromIso) query = query.gte('created_at', fromIso);
    if (q) {
      const safe = q.replace(/[%,()]/g, ' ').trim();
      const digits = normalizePhone(q);
      const parts = [`name.ilike.%${safe}%`, `email.ilike.%${safe}%`];
      if (digits.length >= 4) parts.push(`phone.ilike.%${digits}%`);
      query = query.or(parts.join(','));
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < SCAN_PAGE) break;
    from += SCAN_PAGE;
  }
  return rows;
}

/**
 * GET /api/admin/crm/leads — lista leads capturados com filtros, paginação e nº de ocorrência por telefone.
 * Query: q, capture_status, gerente_id, captador_id, period (todos|hoje|7d|30d), duplicates=1, page, page_size, all=1 (export)
 */
export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireAdmin(req);
    const zaplotoId = await getEffectiveZaplotoId(req, profile);
    const profiles = await getTenantProfiles(zaplotoId);
    const tenantUserIds = profiles.map((p: any) => p.id);
    const profileById = new Map<string, any>(profiles.map((p: any) => [p.id, p]));

    const sp = req.nextUrl.searchParams;
    const period = sp.get('period') || 'todos';
    let fromIso: string | undefined;
    if (period === 'hoje') {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      fromIso = d.toISOString();
    } else if (period === '7d') {
      fromIso = new Date(Date.now() - 7 * 86400000).toISOString();
    } else if (period === '30d') {
      fromIso = new Date(Date.now() - 30 * 86400000).toISOString();
    }

    const rows = await scanLeads({
      tenantUserIds,
      zaplotoId,
      q: sp.get('q') || undefined,
      captureStatus: sp.get('capture_status') || undefined,
      gerenteId: sp.get('gerente_id') || undefined,
      captadorId: sp.get('captador_id') || undefined,
      fromIso,
    });

    // Nº de ocorrência por telefone (1ª, 2ª, 3ª vez...) — mais antigo = 1ª vez
    const byPhone = new Map<string, any[]>();
    rows.forEach((r) => {
      const digits = normalizePhone(r.phone);
      if (!digits) return;
      const arr = byPhone.get(digits) || [];
      arr.push(r);
      byPhone.set(digits, arr);
    });
    const occurrence = new Map<string, { n: number; total: number }>();
    byPhone.forEach((arr) => {
      const sorted = [...arr].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      sorted.forEach((r, i) => occurrence.set(r.id, { n: i + 1, total: sorted.length }));
    });

    let filtered = rows;
    if (sp.get('duplicates') === '1') {
      filtered = rows.filter((r) => (occurrence.get(r.id)?.total || 1) > 1);
    }

    const total = filtered.length;
    const exportAll = sp.get('all') === '1';
    const pageSize = exportAll ? total : Math.min(200, Math.max(1, parseInt(sp.get('page_size') || `${PAGE_SIZE_DEFAULT}`, 10) || PAGE_SIZE_DEFAULT));
    const page = exportAll ? 1 : Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
    const paged = exportAll ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize);

    const leads = paged.map((r) => {
      const captador = r.user_id ? profileById.get(r.user_id) : null;
      const gerente = r.gerente_id
        ? profileById.get(r.gerente_id)
        : captador?.enroller
          ? profileById.get(captador.enroller)
          : null;
      const occ = occurrence.get(r.id);
      return {
        id: r.id,
        external_id: String(r.external_id),
        name: [r.name, r.last_name].filter(Boolean).join(' ') || null,
        phone: r.phone,
        email: r.email,
        capture_status: r.capture_status || 'pendente',
        source: r.source,
        created_at: r.created_at,
        captador_id: r.user_id,
        captador_name: captador ? (captador.full_name || captador.email) : null,
        gerente_id: r.gerente_id || (gerente ? gerente.id : null),
        gerente_name: gerente ? (gerente.full_name || gerente.email) : null,
        occurrence: occ?.n || 1,
        occurrence_total: occ?.total || 1,
      };
    });

    return successResponse({
      leads,
      total,
      page,
      page_size: pageSize,
      gerentes: profiles
        .filter((p: any) => p.status === 'gerente')
        .map((p: any) => ({ id: p.id, name: p.full_name || p.email })),
      captadores: profiles
        .filter((p: any) => p.status === 'captador')
        .map((p: any) => ({ id: p.id, name: p.full_name || p.email, enroller: p.enroller })),
    });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * POST /api/admin/crm/leads — cadastra um lead manualmente.
 * Body: { name, phone, email?, gerente_id?, captador_id? }
 * Se captador_id vier, o lead já entra no kanban do captador (coluna inicial).
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);
    const zaplotoId = await getEffectiveZaplotoId(req, profile);
    const body = await req.json().catch(() => ({}));

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const phone = normalizePhone(body.phone);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : null;
    const gerenteId = body.gerente_id || null;
    const captadorId = body.captador_id || null;

    if (!name && !phone) {
      return errorResponse('Informe pelo menos nome ou WhatsApp.', 400);
    }

    const externalId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    const nowIso = new Date().toISOString();

    const { data: inserted, error } = await supabaseServiceRole
      .from('crm_leads')
      .insert({
        external_id: externalId,
        user_id: captadorId,
        gerente_id: gerenteId,
        name: name || null,
        phone: phone || null,
        email: email || null,
        status: 'novo',
        capture_status: 'pendente',
        source: 'manual',
        zaploto_id: zaplotoId,
        assigned_by: captadorId ? userId : null,
        assigned_at: captadorId ? nowIso : null,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select('id, external_id')
      .single();

    if (error || !inserted) {
      return errorResponse(`Erro ao cadastrar lead: ${error?.message || 'desconhecido'}`, 400);
    }

    // Já atribuído a captador: entra no kanban dele (mesma engine do board)
    if (captadorId) {
      await supabaseServiceRole.rpc('crm_move_lead', {
        p_lead_external_id: String(externalId),
        p_user_id: captadorId,
        p_column_key: 'novo',
        p_position: 0,
        p_moved_by: userId,
      });
    }

    return successResponse({ id: inserted.id, external_id: String(inserted.external_id) }, 'Lead cadastrado com sucesso!');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * PATCH /api/admin/crm/leads — atualiza/atribui leads (aceita 1 ou vários ids).
 * Body: { ids: string[], capture_status?, gerente_id?, captador_id? }
 * captador_id: '' remove o captador (lead volta ao pool); uuid atribui e envia ao kanban.
 */
export async function PATCH(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);
    const zaplotoId = await getEffectiveZaplotoId(req, profile);
    const body = await req.json().catch(() => ({}));

    const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: any) => typeof x === 'string') : [];
    if (ids.length === 0) return errorResponse('ids é obrigatório.', 400);
    if (ids.length > 500) return errorResponse('Máximo de 500 leads por operação.', 400);

    const hasStatus = typeof body.capture_status === 'string' && CAPTURE_STATUSES.includes(body.capture_status);
    const hasGerente = body.gerente_id !== undefined;
    const hasCaptador = body.captador_id !== undefined;
    if (!hasStatus && !hasGerente && !hasCaptador) {
      return errorResponse('Nada para atualizar.', 400);
    }

    const { data: leads, error: leadsErr } = await supabaseServiceRole
      .from('crm_leads')
      .select('id, external_id, user_id')
      .in('id', ids);
    if (leadsErr) return errorResponse(leadsErr.message, 400);

    const nowIso = new Date().toISOString();
    const captadorId = hasCaptador ? (body.captador_id || null) : undefined;

    // Validações de cargo
    if (hasGerente && body.gerente_id) {
      const { data: g } = await supabaseServiceRole.from('profiles').select('id, status').eq('id', body.gerente_id).single();
      if (!g || g.status !== 'gerente') return errorResponse('Gerente inválido.', 400);
    }
    let captadorEnroller: string | null = null;
    if (hasCaptador && captadorId) {
      const { data: c } = await supabaseServiceRole.from('profiles').select('id, status, enroller').eq('id', captadorId).single();
      if (!c || c.status !== 'captador') return errorResponse('Captador inválido.', 400);
      captadorEnroller = c.enroller || null;
    }

    for (const lead of leads || []) {
      const update: any = { updated_at: nowIso, zaploto_id: zaplotoId };
      if (hasStatus) update.capture_status = body.capture_status;
      if (hasGerente) update.gerente_id = body.gerente_id || null;

      if (hasCaptador) {
        update.user_id = captadorId;
        update.assigned_by = userId;
        update.assigned_at = captadorId ? nowIso : null;
        // Atribuir captador define o gerente automaticamente (enroller), se não informado
        if (!hasGerente && captadorId && captadorEnroller) update.gerente_id = captadorEnroller;
        // Troca de dono: remove o stage antigo do kanban
        if (lead.user_id && lead.user_id !== captadorId) {
          await supabaseServiceRole
            .from('crm_lead_stage')
            .delete()
            .eq('lead_external_id', String(lead.external_id))
            .eq('user_id', lead.user_id);
        }
      }

      const { error: upErr } = await supabaseServiceRole.from('crm_leads').update(update).eq('id', lead.id);
      if (upErr) return errorResponse(`Erro ao atualizar lead: ${upErr.message}`, 400);

      // Entra no kanban do novo captador (coluna inicial)
      if (hasCaptador && captadorId && lead.user_id !== captadorId) {
        await supabaseServiceRole.rpc('crm_move_lead', {
          p_lead_external_id: String(lead.external_id),
          p_user_id: captadorId,
          p_column_key: 'novo',
          p_position: 0,
          p_moved_by: userId,
        });
      }
    }

    return successResponse({ updated: (leads || []).length }, 'Leads atualizados com sucesso!');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * DELETE /api/admin/crm/leads — exclui leads (e seus stages no kanban).
 * Body: { ids: string[] }
 */
export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: any) => typeof x === 'string') : [];
    if (ids.length === 0) return errorResponse('ids é obrigatório.', 400);
    if (ids.length > 500) return errorResponse('Máximo de 500 leads por operação.', 400);

    const { data: leads } = await supabaseServiceRole
      .from('crm_leads')
      .select('id, external_id, user_id')
      .in('id', ids);

    for (const lead of leads || []) {
      if (lead.user_id) {
        await supabaseServiceRole
          .from('crm_lead_stage')
          .delete()
          .eq('lead_external_id', String(lead.external_id))
          .eq('user_id', lead.user_id);
      }
    }

    const { error } = await supabaseServiceRole.from('crm_leads').delete().in('id', ids);
    if (error) return errorResponse(error.message, 400);

    return successResponse({ deleted: ids.length }, 'Leads excluídos.');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
