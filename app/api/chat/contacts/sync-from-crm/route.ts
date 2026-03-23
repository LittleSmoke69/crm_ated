import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getBancasDoUsuario } from '@/app/api/crm/bancas/route';

/** Sincronização pode percorrer muitas bancas/páginas (mesmo padrão do CRM Kanban / Transferido). */
export const maxDuration = 300;

type LeadRow = {
  id?: string;
  phone?: string;
  name?: string;
  last_name?: string;
  status?: string;
  temperature?: string;
  banca_name?: string;
  /** UUID da banca (crm_bancas.id) — presente na resposta formatada de /api/crm/leads e transferidos */
  banca_id?: string;
  total_depositado?: number;
  total_apostado?: number;
  last_interaction?: string;
  tags?: Array<{ label?: string }>;
  transferred_at?: string | null;
  transfer_deadline_days?: number | null;
};

function originFromRequest(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3000';
  const proto = req.headers.get('x-forwarded-proto') ?? (host.includes('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

function normPhone(p: string): string {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 10 ? d : '';
}

function transferExpiresAtIso(
  transferredAt: string | null | undefined,
  deadlineDays: number | null | undefined
): string | null {
  if (!transferredAt || deadlineDays == null || Number.isNaN(Number(deadlineDays))) return null;
  const d = new Date(transferredAt);
  if (Number.isNaN(d.getTime())) return null;
  const end = new Date(d);
  end.setDate(end.getDate() + Math.floor(Number(deadlineDays)));
  return end.toISOString();
}

function buildSnapshot(lead: LeadRow, kind: 'kanban' | 'transferred') {
  const base = {
    kind,
    status: lead.status ?? null,
    banca_name: lead.banca_name ?? null,
    crm_banca_id: lead.banca_id ?? null,
    temperature: lead.temperature ?? null,
    total_depositado: lead.total_depositado ?? null,
    total_apostado: lead.total_apostado ?? null,
    last_interaction: lead.last_interaction ?? null,
    tag_labels: (lead.tags ?? []).slice(0, 6).map((t) => t?.label).filter(Boolean) as string[],
  };
  if (kind !== 'transferred') return base;
  return {
    ...base,
    transferred_at: lead.transferred_at ?? null,
    transfer_deadline_days: lead.transfer_deadline_days ?? null,
    transfer_expires_at: transferExpiresAtIso(lead.transferred_at ?? null, lead.transfer_deadline_days ?? null),
  };
}

type CrmFetchMeta = {
  next?: { banca_index: number; page: number } | null;
  total_bancas?: number;
  totalBancas?: number;
  has_more_pages_in_banca?: boolean;
};

async function fetchCrmJson(
  req: NextRequest,
  userId: string,
  pathWithQuery: string
): Promise<{ data: LeadRow[]; meta?: CrmFetchMeta }> {
  const url = `${originFromRequest(req)}${pathWithQuery}`;
  const res = await fetch(url, {
    headers: {
      'X-User-Id': userId,
      Cookie: req.headers.get('cookie') ?? '',
      Accept: 'application/json',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(90000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: unknown;
    meta?: CrmFetchMeta;
  };
  if (!res.ok || !json.success || !Array.isArray(json.data)) {
    console.warn('[chat/contacts/sync-from-crm] fetch falhou', pathWithQuery, res.status, json);
    return { data: [], meta: json.meta };
  }
  return { data: json.data as LeadRow[], meta: json.meta };
}

/** Mesmo fluxo em fatias que o CRM Kanban: `banca_index` + `page` até `meta.next` ser null. */
async function fetchAllKanbanLeadsChunked(
  req: NextRequest,
  userId: string,
  qsBase: URLSearchParams
): Promise<LeadRow[]> {
  const all: LeadRow[] = [];
  let next: { banca_index: number; page: number } | null = { banca_index: 0, page: 1 };
  for (let guard = 0; next !== null && guard < 5000; guard++) {
    const params = new URLSearchParams(qsBase);
    params.set('banca_index', String(next.banca_index));
    params.set('page', String(next.page));
    const { data, meta } = await fetchCrmJson(req, userId, `/api/crm/leads?${params.toString()}`);
    all.push(...data);
    const n = meta?.next;
    if (n != null && typeof n.banca_index === 'number' && typeof n.page === 'number') {
      next = n;
    } else {
      next = null;
    }
  }
  return all;
}

/** Mesmo fluxo que a tela CRM Transferido: por banca, páginas até `has_more_pages_in_banca` ser false. */
async function fetchAllTransferredLeadsChunked(
  req: NextRequest,
  userId: string,
  qsBase: URLSearchParams
): Promise<LeadRow[]> {
  const all: LeadRow[] = [];
  let totalBancas = 1;
  for (let bancaIndex = 0; ; bancaIndex++) {
    let page = 1;
    let hasMoreInBanca = true;
    while (hasMoreInBanca) {
      const params = new URLSearchParams(qsBase);
      params.set('banca_index', String(bancaIndex));
      params.set('page', String(page));
      const { data, meta } = await fetchCrmJson(req, userId, `/api/crm/transferred-leads?${params.toString()}`);
      const tb = meta?.total_bancas ?? meta?.totalBancas;
      if (typeof tb === 'number' && tb > 0) totalBancas = tb;
      all.push(...data);
      hasMoreInBanca = meta?.has_more_pages_in_banca === true;
      if (!hasMoreInBanca) break;
      page++;
    }
    if (bancaIndex >= totalBancas - 1) break;
  }
  return all;
}

function buildUpsertRow(
  userId: string,
  phone: string,
  kind: 'kanban' | 'transferred',
  lead: LeadRow,
  existingByPhone: Map<string, { name?: string | null; horario?: string | null; is_pinned_manual?: boolean | null }>
) {
  const ex = existingByPhone.get(phone);
  const pinned = ex?.is_pinned_manual === true;
  const fromLead = [lead.name, lead.last_name].filter(Boolean).join(' ').trim();
  const displayName = fromLead || (ex?.name as string) || phone;
  /** Contato fixado manualmente permanece `manual`; ainda atualizamos snapshot para o card. */
  const syncKind = pinned ? 'manual' : kind;
  return {
    user_id: userId,
    telefone: phone,
    name: pinned ? (ex?.name ?? displayName) : displayName,
    horario: pinned ? ex?.horario ?? null : ex?.horario ?? null,
    crm_sync_kind: syncKind,
    crm_external_id: lead.id ?? null,
    crm_snapshot: buildSnapshot(lead, kind),
    is_pinned_manual: pinned,
    updated_at: new Date().toISOString(),
  };
}

/**
 * POST /api/chat/contacts/sync-from-crm
 * Sincroniza contatos do consultor com CRM (kanban + transferidos).
 * - Transferidos: removidos da tabela quando saem do CRM (exceto contatos fixados manualmente).
 * - Kanban: upsert com dados atuais; linhas antigas permanecem se o lead sumir do funil.
 * Perfis: consultor e gerente (CRM do próprio usuário logado).
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const profile = await getUserProfile(userId);
    if (!profile || (profile.status !== 'consultor' && profile.status !== 'gerente')) {
      return errorResponse(
        'Sincronização com o CRM está disponível apenas para consultores e gerentes.',
        403
      );
    }

    const bancasUsuario = await getBancasDoUsuario(userId);
    let kanbanLeads: LeadRow[] = [];
    let transferredLeads: LeadRow[] = [];
    if (bancasUsuario.length === 0) {
      console.warn(
        '[chat/contacts/sync-from-crm] user_bancas vazio — não busca CRM (evita incluir leads de todas as bancas).'
      );
    } else {
      const bancaUrls = bancasUsuario.map((b) => b.url).filter((u) => !!String(u || '').trim());
      const qsLeads = new URLSearchParams({ userId });
      const qsTransferred = new URLSearchParams({ userId, full: '1' });
      if (bancaUrls.length > 0) {
        const joined = bancaUrls.join(',');
        qsLeads.set('banca_urls', joined);
        qsTransferred.set('banca_urls', joined);
      }
      console.log('[chat/contacts/sync-from-crm] Início busca CRM em lotes (kanban + transferidos)');
      [kanbanLeads, transferredLeads] = await Promise.all([
        fetchAllKanbanLeadsChunked(req, userId, qsLeads),
        fetchAllTransferredLeadsChunked(req, userId, qsTransferred),
      ]);
      console.log(
        '[chat/contacts/sync-from-crm] Fim busca CRM em lotes | kanban=',
        kanbanLeads.length,
        'transferidos=',
        transferredLeads.length
      );
    }

    const transferredByPhone = new Map<string, LeadRow>();
    for (const lead of transferredLeads) {
      const ph = normPhone(lead.phone || '');
      if (ph) transferredByPhone.set(ph, lead);
    }

    const kanbanByPhone = new Map<string, LeadRow>();
    for (const lead of kanbanLeads) {
      const ph = normPhone(lead.phone || '');
      if (ph) kanbanByPhone.set(ph, lead);
    }

    const { data: existingRows, error: existingErr } = await supabaseServiceRole
      .from('chat_conversation_contacts')
      .select('telefone, name, horario, is_pinned_manual')
      .eq('user_id', userId);

    if (existingErr) {
      return errorResponse(`Erro ao ler contatos: ${existingErr.message}`);
    }

    const existingByPhone = new Map<
      string,
      { name?: string | null; horario?: string | null; is_pinned_manual?: boolean | null }
    >();
    for (const row of existingRows ?? []) {
      const r = row as {
        telefone: string;
        name?: string | null;
        horario?: string | null;
        is_pinned_manual?: boolean | null;
      };
      existingByPhone.set(String(r.telefone), {
        name: r.name,
        horario: r.horario,
        is_pinned_manual: r.is_pinned_manual,
      });
    }

    const transferredSet = new Set(transferredByPhone.keys());

    const { data: staleTransferred } = await supabaseServiceRole
      .from('chat_conversation_contacts')
      .select('id, telefone')
      .eq('user_id', userId)
      .eq('crm_sync_kind', 'transferred')
      .eq('is_pinned_manual', false);

    const idsToDelete = (staleTransferred ?? [])
      .filter((r) => {
        const t = (r as { telefone: string }).telefone;
        return transferredSet.size === 0 || !transferredSet.has(t);
      })
      .map((r) => (r as { id: string }).id);

    if (idsToDelete.length > 0) {
      const { error: delErr } = await supabaseServiceRole.from('chat_conversation_contacts').delete().in('id', idsToDelete);
      if (delErr) {
        console.error('[sync-from-crm] delete stale transferred:', delErr.message);
      }
    }

    const byPhone = new Map<string, Record<string, unknown>>();
    for (const [phone, lead] of transferredByPhone) {
      byPhone.set(phone, buildUpsertRow(userId, phone, 'transferred', lead, existingByPhone));
    }
    for (const [phone, lead] of kanbanByPhone) {
      byPhone.set(phone, buildUpsertRow(userId, phone, 'kanban', lead, existingByPhone));
    }

    const finalRows = Array.from(byPhone.values());
    const chunkSize = 80;
    for (let i = 0; i < finalRows.length; i += chunkSize) {
      const chunk = finalRows.slice(i, i + chunkSize);
      const { error: upErr } = await supabaseServiceRole
        .from('chat_conversation_contacts')
        .upsert(chunk, { onConflict: 'user_id,telefone' });
      if (upErr) {
        return errorResponse(`Erro ao salvar contatos CRM: ${upErr.message}`);
      }
    }

    return successResponse({
      deleted_transferred_stale: idsToDelete.length,
      upserted: finalRows.length,
      kanban_phones: kanbanByPhone.size,
      transferred_phones: transferredByPhone.size,
    });
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}
