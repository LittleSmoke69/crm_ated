import { NextRequest } from 'next/server';
import { requireLeadsManagementAccess } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';
import { getConsultorsByManager } from '@/lib/utils/hierarchy';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const CAPTURE_STATUSES = ['pendente', 'em_contato', 'convertido', 'descartado'] as const;
const PAGE_SIZE_DEFAULT = 25;
const SCAN_PAGE = 1000;
const SCAN_MAX = 20000;
/** PostgREST .in() na querystring — chunks grandes geram 414. */
const IN_CHUNK = 80;
const STAGE_UPSERT_CHUNK = 200;
/** Coluna padrão ao atribuir lead ao captador. */
const DEFAULT_ASSIGN_COLUMN = 'novo';
/** Filtro especial: leads sem captador (pool / não atribuídos). */
const UNASSIGNED_COLUMN_FILTER = '__unassigned__';

function normalizePhone(v: string | null | undefined): string {
  return String(v || '').replace(/\D/g, '');
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** Interpreta period + date (YYYY-MM-DD) em janela [fromIso, toIso). */
function resolvePeriodRange(
  periodRaw: string | null,
  dateRaw: string | null
): { period: string; fromIso?: string; toIso?: string; date?: string } {
  const period = (periodRaw || 'todos').trim().toLowerCase() || 'todos';
  if (period === 'todos') return { period };

  const startOfLocalDay = (y: number, m: number, d: number) => {
    const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
    return dt;
  };

  const parseYmd = (s: string): { y: number; m: number; d: number } | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y, m: mo, d };
  };

  if (period === '7d') {
    return { period, fromIso: new Date(Date.now() - 7 * 86400000).toISOString() };
  }
  if (period === '30d') {
    return { period, fromIso: new Date(Date.now() - 30 * 86400000).toISOString() };
  }

  // hoje | dia — janela de 1 dia (local)
  const today = new Date();
  const ymd =
    (period === 'dia' || period === 'hoje') && dateRaw
      ? parseYmd(dateRaw)
      : { y: today.getFullYear(), m: today.getMonth() + 1, d: today.getDate() };
  const day = ymd || { y: today.getFullYear(), m: today.getMonth() + 1, d: today.getDate() };
  const from = startOfLocalDay(day.y, day.m, day.d);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  const date = `${day.y}-${String(day.m).padStart(2, '0')}-${String(day.d).padStart(2, '0')}`;
  return {
    period: period === 'dia' ? 'dia' : 'hoje',
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    date,
  };
}

/** Resolve coluna do kanban: preferredKey → novo → status_pendente → primeira ativa. */
async function resolveKanbanColumn(
  zaplotoId: string | null,
  preferredKey?: string | null
): Promise<{ id: string; key: string; title: string } | null> {
  const preferredKeys = [
    ...(preferredKey ? [String(preferredKey).trim()] : []),
    DEFAULT_ASSIGN_COLUMN,
    'status_pendente',
  ].filter(Boolean);
  const seen = new Set<string>();

  const findByKey = async (key: string) => {
    if (zaplotoId) {
      const scoped = await supabaseServiceRole
        .from('crm_columns')
        .select('id, key, title')
        .eq('key', key)
        .eq('is_active', true)
        .or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`)
        .limit(1)
        .maybeSingle();
      if (scoped.data?.id && scoped.data?.key) {
        return {
          id: scoped.data.id,
          key: scoped.data.key,
          title: (scoped.data as { title?: string }).title || scoped.data.key,
        };
      }
    }
    const any = await supabaseServiceRole
      .from('crm_columns')
      .select('id, key, title')
      .eq('key', key)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (any.data?.id && any.data?.key) {
      return {
        id: any.data.id,
        key: any.data.key,
        title: (any.data as { title?: string }).title || any.data.key,
      };
    }
    return null;
  };

  for (const key of preferredKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const found = await findByKey(key);
    if (found) return found;
  }

  if (zaplotoId) {
    const { data } = await supabaseServiceRole
      .from('crm_columns')
      .select('id, key, title')
      .eq('is_active', true)
      .or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`)
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data?.id && data?.key) {
      return { id: data.id, key: data.key, title: (data as { title?: string }).title || data.key };
    }
  }

  const { data } = await supabaseServiceRole
    .from('crm_columns')
    .select('id, key, title')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id && data?.key
    ? { id: data.id, key: data.key, title: (data as { title?: string }).title || data.key }
    : null;
}

async function listActiveKanbanColumns(zaplotoId: string | null) {
  // Mesma fonte do kanban (/api/crm/board): todas as colunas ativas.
  // Filtro por tenant só como preferência de ordenação/dedupe — nunca esconde a lista do gerente.
  const { data } = await supabaseServiceRole
    .from('crm_columns')
    .select('id, key, title, sort_order, zaploto_id')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  const rows = data || [];
  const preferred = zaplotoId
    ? rows.filter((c: any) => !c.zaploto_id || c.zaploto_id === zaplotoId)
    : rows;
  const use = preferred.length > 0 ? preferred : rows;

  // Dedupa por key (mantém a primeira / menor sort_order)
  const byKey = new Map<string, { id: string; key: string; title: string }>();
  for (const c of use as any[]) {
    if (!c?.key || byKey.has(c.key)) continue;
    byKey.set(c.key, {
      id: c.id as string,
      key: c.key as string,
      title: (c.title as string) || (c.key as string),
    });
  }
  return Array.from(byKey.values());
}

/** Estágio atual (column_key) por lead_external_id:user_id. */
async function fetchStagesByLeadUser(
  pairs: { external_id: string; user_id: string }[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (pairs.length === 0) return map;
  const byUser = new Map<string, string[]>();
  for (const p of pairs) {
    if (!p.user_id || !p.external_id) continue;
    const list = byUser.get(p.user_id) || [];
    list.push(p.external_id);
    byUser.set(p.user_id, list);
  }
  for (const [uid, extIds] of byUser) {
    for (const chunk of chunkArray([...new Set(extIds)], IN_CHUNK)) {
      const { data, error } = await supabaseServiceRole
        .from('crm_lead_stage')
        .select('lead_external_id, user_id, column_key')
        .eq('user_id', uid)
        .in('lead_external_id', chunk);
      if (error) throw new Error(error.message);
      for (const s of data || []) {
        const row = s as { lead_external_id: string; user_id: string; column_key: string };
        map.set(`${String(row.lead_external_id)}:${row.user_id}`, row.column_key);
      }
    }
  }
  return map;
}

/** Leads na coluna informada (external_id:user_id). */
async function fetchLeadKeysInColumn(columnKey: string, captadorIds: string[]): Promise<Set<string>> {
  const keys = new Set<string>();
  if (!columnKey || captadorIds.length === 0) return keys;
  for (const chunk of chunkArray(captadorIds, IN_CHUNK)) {
    let from = 0;
    for (;;) {
      const { data, error } = await supabaseServiceRole
        .from('crm_lead_stage')
        .select('lead_external_id, user_id')
        .in('user_id', chunk)
        .eq('column_key', columnKey)
        .range(from, from + SCAN_PAGE - 1);
      if (error) throw new Error(error.message);
      const batch = data || [];
      for (const s of batch) {
        const row = s as { lead_external_id: string; user_id: string };
        keys.add(`${String(row.lead_external_id)}:${row.user_id}`);
      }
      if (batch.length < SCAN_PAGE) break;
      from += SCAN_PAGE;
    }
  }
  return keys;
}

/** Fallback de keys conhecidas (além das resolvidas pelo título). */
const WON_COLUMN_KEY_FALLBACKS = ['status_convertido', 'convertido', 'ganho'] as const;
const VENDA_TAG_LABELS = ['venda', 'venda fechada'];

type CaptadorSalesRow = {
  id: string;
  name: string;
  total_leads: number;
  vendas_fechadas: number;
  taxa_vendas: number;
};

type SalesSummary = {
  /** Total de leads atribuídos (com captador) no escopo do viewer. */
  total_leads: number;
  total_vendas: number;
  taxa: number;
  /** Pool sem captador — só admin/super_admin/gerente; captador sempre 0. */
  total_nao_atribuidos: number;
  by_captador: CaptadorSalesRow[];
};

function normalizeLabel(v: string): string {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

/** Colunas que contam como venda: Convertido, Cliente ganho, Venda fechada (por título ou key). */
async function resolveWonColumnKeys(): Promise<string[]> {
  const { data } = await supabaseServiceRole
    .from('crm_columns')
    .select('key, title')
    .eq('is_active', true);

  const keys = new Set<string>([...WON_COLUMN_KEY_FALLBACKS]);
  for (const c of data || []) {
    const key = String((c as { key?: string }).key || '');
    if (!key) continue;
    const titleN = normalizeLabel((c as { title?: string }).title || '');
    const keyN = normalizeLabel(key);
    if (
      titleN.includes('convertid') ||
      titleN.includes('venda fechada') ||
      titleN.includes('cliente ganho') ||
      keyN.includes('convertid') ||
      keyN === 'ganho' ||
      (keyN.includes('venda') && keyN.includes('fechad'))
    ) {
      keys.add(key);
    }
  }
  return [...keys];
}

/** Ids das etiquetas de venda (Venda / Venda fechada). */
async function resolveVendaTagIds(): Promise<string[]> {
  const { data } = await supabaseServiceRole.from('crm_tags').select('id, label');
  const wanted = new Set(VENDA_TAG_LABELS);
  return (data || [])
    .filter((t: any) => wanted.has(normalizeLabel(t.label || '')))
    .map((t: any) => String(t.id));
}

/**
 * Vendas fechadas (OR), alinhado ao kanban:
 * - estágio do captador em Convertido / ganho / venda fechada, OU
 * - sem estágio mas a 1ª coluna do funil é Convertido (mesmo fallback do board), OU
 * - etiqueta Venda / Venda fechada
 */
/** Conta leads sem captador no escopo (admin = tenant; gerente = pool dele). */
async function countUnassignedLeads(params: {
  isCaptador: boolean;
  isGerente: boolean;
  userId: string;
  zaplotoId: string;
  fromIso?: string;
  toIso?: string;
}): Promise<number> {
  const { isCaptador, isGerente, userId, zaplotoId, fromIso, toIso } = params;
  if (isCaptador) return 0;

  let total = 0;
  let from = 0;
  for (;;) {
    let query = supabaseServiceRole
      .from('crm_leads')
      .select('id')
      .is('user_id', null)
      .range(from, from + SCAN_PAGE - 1);

    if (isGerente) {
      query = query.eq('gerente_id', userId);
    } else {
      // Admin: pool realmente livre (chat→gerente já tem gerente_id e não conta aqui)
      query = query.is('gerente_id', null).or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`);
    }
    if (fromIso) query = query.gte('created_at', fromIso);
    if (toIso) query = query.lt('created_at', toIso);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const batch = data || [];
    total += batch.length;
    if (batch.length < SCAN_PAGE) break;
    from += SCAN_PAGE;
  }
  return total;
}

async function countWonSales(
  captadorIds: string[],
  nameById: Map<string, string>,
  totalNaoAtribuidos = 0,
  range?: { fromIso?: string; toIso?: string }
): Promise<SalesSummary> {
  const empty: SalesSummary = {
    total_leads: 0,
    total_vendas: 0,
    taxa: 0,
    total_nao_atribuidos: totalNaoAtribuidos,
    by_captador: [],
  };
  if (captadorIds.length === 0) return empty;

  const stats = new Map<string, { total: number; vendas: number }>();
  for (const id of captadorIds) stats.set(id, { total: 0, vendas: 0 });

  const { data: cols } = await supabaseServiceRole
    .from('crm_columns')
    .select('key, title, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  const firstKey = String((cols?.[0] as { key?: string } | undefined)?.key || 'novo');
  const wonKeys = new Set(await resolveWonColumnKeys());
  // Se a 1ª coluna do kanban é Convertido, leads sem estágio caem nela (paridade com /api/crm/board)
  const defaultIsWon = wonKeys.has(firstKey);

  const leadPairs: { external_id: string; user_id: string }[] = [];
  for (const chunk of chunkArray(captadorIds, IN_CHUNK)) {
    let from = 0;
    for (;;) {
      let query = supabaseServiceRole
        .from('crm_leads')
        .select('external_id, user_id')
        .in('user_id', chunk)
        .range(from, from + SCAN_PAGE - 1);
      if (range?.fromIso) query = query.gte('created_at', range.fromIso);
      if (range?.toIso) query = query.lt('created_at', range.toIso);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      const batch = data || [];
      for (const row of batch) {
        const uid = (row as { user_id?: string }).user_id;
        if (!uid || !stats.has(uid)) continue;
        leadPairs.push({
          external_id: String((row as { external_id: number | string }).external_id),
          user_id: uid,
        });
        stats.get(uid)!.total += 1;
      }
      if (batch.length < SCAN_PAGE) break;
      from += SCAN_PAGE;
    }
  }

  // Estágio atual por lead+captador
  const stageByLeadUser = new Map<string, string>();
  for (const chunk of chunkArray(captadorIds, IN_CHUNK)) {
    let from = 0;
    for (;;) {
      const { data, error } = await supabaseServiceRole
        .from('crm_lead_stage')
        .select('lead_external_id, user_id, column_key')
        .in('user_id', chunk)
        .range(from, from + SCAN_PAGE - 1);
      if (error) throw new Error(error.message);
      const batch = data || [];
      for (const s of batch) {
        const row = s as { lead_external_id: string; user_id: string; column_key: string };
        stageByLeadUser.set(`${String(row.lead_external_id)}:${row.user_id}`, row.column_key);
      }
      if (batch.length < SCAN_PAGE) break;
      from += SCAN_PAGE;
    }
  }

  const wonLeadKeys = new Set<string>();
  for (const p of leadPairs) {
    const key = `${p.external_id}:${p.user_id}`;
    const col = stageByLeadUser.get(key) ?? (defaultIsWon ? firstKey : null);
    if (col && wonKeys.has(col)) wonLeadKeys.add(key);
  }

  const vendaTagIds = await resolveVendaTagIds();
  if (vendaTagIds.length > 0) {
    for (const chunk of chunkArray(captadorIds, IN_CHUNK)) {
      let from = 0;
      for (;;) {
        const { data, error } = await supabaseServiceRole
          .from('crm_lead_tags')
          .select('lead_external_id, user_id')
          .in('user_id', chunk)
          .in('tag_id', vendaTagIds)
          .range(from, from + SCAN_PAGE - 1);
        if (error) throw new Error(error.message);
        const batch = data || [];
        for (const t of batch) {
          const row = t as { lead_external_id: string; user_id: string };
          if (!stats.has(row.user_id)) continue;
          wonLeadKeys.add(`${String(row.lead_external_id)}:${row.user_id}`);
        }
        if (batch.length < SCAN_PAGE) break;
        from += SCAN_PAGE;
      }
    }
  }

  for (const key of wonLeadKeys) {
    const uid = key.slice(key.lastIndexOf(':') + 1);
    const st = stats.get(uid);
    if (st) st.vendas += 1;
  }

  let totalLeads = 0;
  let totalVendas = 0;
  const byCaptador: CaptadorSalesRow[] = [];
  for (const id of captadorIds) {
    const st = stats.get(id) ?? { total: 0, vendas: 0 };
    totalLeads += st.total;
    totalVendas += st.vendas;
    const taxa = st.total > 0 ? Math.round((st.vendas / st.total) * 1000) / 10 : 0;
    byCaptador.push({
      id,
      name: nameById.get(id) || 'Captador',
      total_leads: st.total,
      vendas_fechadas: st.vendas,
      taxa_vendas: taxa,
    });
  }
  byCaptador.sort(
    (a, b) => b.vendas_fechadas - a.vendas_fechadas || b.taxa_vendas - a.taxa_vendas || a.name.localeCompare(b.name)
  );

  const taxa = totalLeads > 0 ? Math.round((totalVendas / totalLeads) * 1000) / 10 : 0;
  return {
    total_leads: totalLeads,
    total_vendas: totalVendas,
    taxa,
    total_nao_atribuidos: totalNaoAtribuidos,
    by_captador: byCaptador,
  };
}

async function fetchLeadsByIds(ids: string[]) {
  const rows: { id: string; external_id: number | string; user_id: string | null; gerente_id: string | null }[] = [];
  for (const chunk of chunkArray(ids, IN_CHUNK)) {
    const { data, error } = await supabaseServiceRole
      .from('crm_leads')
      .select('id, external_id, user_id, gerente_id')
      .in('id', chunk);
    if (error) throw new Error(error.message);
    rows.push(...((data as typeof rows) || []));
  }
  return rows;
}

/** Coloca leads no kanban do captador em lote (sem RPC por lead). */
async function placeLeadsOnCaptadorKanban(params: {
  leads: { id: string; external_id: number | string; user_id: string | null }[];
  captadorId: string;
  movedBy: string;
  column: { id: string; key: string };
  nowIso: string;
}) {
  const { leads, captadorId, movedBy, column, nowIso } = params;

  // Remove estágio antigo quando troca de captador (agrupado por dono anterior)
  const byPrevOwner = new Map<string, string[]>();
  for (const lead of leads) {
    if (lead.user_id && lead.user_id !== captadorId) {
      const list = byPrevOwner.get(lead.user_id) || [];
      list.push(String(lead.external_id));
      byPrevOwner.set(lead.user_id, list);
    }
  }
  for (const [prevOwnerId, extIds] of byPrevOwner) {
    for (const extChunk of chunkArray(extIds, IN_CHUNK)) {
      const { error } = await supabaseServiceRole
        .from('crm_lead_stage')
        .delete()
        .eq('user_id', prevOwnerId)
        .in('lead_external_id', extChunk);
      if (error) throw new Error(`Erro ao limpar kanban anterior: ${error.message}`);
    }
  }

  const stageRows = leads.map((lead, i) => ({
    lead_external_id: String(lead.external_id),
    user_id: captadorId,
    column_id: column.id,
    column_key: column.key,
    position: i,
    is_manual: true,
    moved_by: movedBy,
    moved_at: nowIso,
    updated_at: nowIso,
  }));

  for (const chunk of chunkArray(stageRows, STAGE_UPSERT_CHUNK)) {
    const { error } = await supabaseServiceRole
      .from('crm_lead_stage')
      .upsert(chunk, { onConflict: 'lead_external_id,user_id' });
    if (error) throw new Error(`Erro ao posicionar no kanban: ${error.message}`);
  }
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
  /** Limite exclusivo do período (ex.: início do dia seguinte). */
  toIso?: string;
  /** Pool sem captador (user_id null). */
  unassignedOnly?: boolean;
  /** Quando definido, restringe a leads do gerente (pool + equipe). */
  scopeGerenteId?: string;
  scopeTeamIds?: string[];
  /** Captador: só leads atribuídos a ele. */
  scopeCaptadorId?: string;
  /** Filtro TAG: ads | disparo | importado */
  acquisitionTag?: string;
  /** Para listagem rápida: para o scan após N linhas (total ainda aproximado se truncated). */
  maxRows?: number;
}) {
  const {
    tenantUserIds,
    zaplotoId,
    q,
    captureStatus,
    gerenteId,
    captadorId,
    fromIso,
    toIso,
    unassignedOnly,
    scopeGerenteId,
    scopeTeamIds,
    scopeCaptadorId,
    acquisitionTag,
    maxRows = SCAN_MAX,
  } = params;
  const rows: any[] = [];
  let from = 0;
  const limit = Math.min(SCAN_MAX, Math.max(1, maxRows));
  while (rows.length < limit) {
    const pageEnd = Math.min(from + SCAN_PAGE - 1, from + (limit - rows.length) - 1);
    let query = supabaseServiceRole
      .from('crm_leads')
      .select('id, external_id, user_id, gerente_id, name, last_name, phone, email, capture_status, source, acquisition_tag, created_at, zaploto_id')
      .order('created_at', { ascending: false })
      .range(from, pageEnd);

    // Escopo: leads de usuários do tenant OU pendentes (sem dono) do tenant/legado
    const idsList = tenantUserIds.join(',');
    if (scopeCaptadorId) {
      query = query.eq('user_id', scopeCaptadorId);
    } else if (scopeGerenteId) {
      const teamIds = (scopeTeamIds ?? []).filter(Boolean);
      if (unassignedOnly) {
        // Pool do gerente sem captador
        query = query.eq('gerente_id', scopeGerenteId).is('user_id', null);
      } else if (teamIds.length > 0) {
        query = query.or(`gerente_id.eq.${scopeGerenteId},user_id.in.(${teamIds.join(',')})`);
      } else {
        query = query.eq('gerente_id', scopeGerenteId);
      }
    } else {
      // Admin: todos os leads do tenant (por zaploto_id), leads de usuários do tenant e legado sem dono
      if (unassignedOnly) {
        // Admin: só pool livre (sem gerente e sem captador).
        // Leads do chat já delegados ao gerente têm gerente_id e NÃO entram aqui.
        query = query
          .is('user_id', null)
          .is('gerente_id', null)
          .or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`);
      } else {
        const parts = [`zaploto_id.eq.${zaplotoId}`];
        if (idsList) parts.push(`user_id.in.(${idsList})`);
        parts.push('and(user_id.is.null,zaploto_id.is.null)');
        query = query.or(parts.join(','));
      }
    }

    if (unassignedOnly && scopeCaptadorId) {
      // Captador não tem pool — resultado vazio
      return [];
    }
    if (unassignedOnly && !scopeGerenteId && !scopeCaptadorId) {
      // já aplicado acima no branch admin
    } else if (unassignedOnly && captadorId) {
      return [];
    }

    if (captureStatus && CAPTURE_STATUSES.includes(captureStatus as any)) {
      query = query.eq('capture_status', captureStatus);
    }
    if (gerenteId) query = query.eq('gerente_id', gerenteId);
    if (captadorId) query = query.eq('user_id', captadorId);
    if (fromIso) query = query.gte('created_at', fromIso);
    if (toIso) query = query.lt('created_at', toIso);
    if (acquisitionTag === 'importado') {
      // legado: campanha → importado (até migration 33 concluir em todos os ambientes)
      query = query.in('acquisition_tag', ['importado', 'campanha']);
    } else if (acquisitionTag) {
      query = query.eq('acquisition_tag', acquisitionTag);
    }
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
 * Query: q, column_key (__unassigned__ = sem captador), capture_status, gerente_id, captador_id,
 *        period, duplicates=1, page, page_size, all=1, include_sales=1
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireLeadsManagementAccess(req);
    const isGerente = profile.status === 'gerente';
    const isCaptador = profile.status === 'captador';
    const zaplotoId = await getEffectiveZaplotoId(req, profile);
    const includeSales = req.nextUrl.searchParams.get('include_sales') === '1';
    const salesOnly = req.nextUrl.searchParams.get('sales_only') === '1';

    const sp = req.nextUrl.searchParams;
    const { fromIso, toIso, period, date: periodDate } = resolvePeriodRange(
      sp.get('period'),
      sp.get('date')
    );

    const columnFilter = (sp.get('column_key') || '').trim();
    const unassignedOnly = columnFilter === UNASSIGNED_COLUMN_FILTER;

    // Pool "Não atribuídos" só para admin/super_admin/gerente
    if (unassignedOnly && isCaptador) {
      return errorResponse('Captador não pode filtrar leads não atribuídos.', 403);
    }

    // Profiles + colunas em paralelo (sales só sob demanda)
    const [profiles, columns, teamCaptadores] = await Promise.all([
      getTenantProfiles(zaplotoId),
      salesOnly ? Promise.resolve([] as Awaited<ReturnType<typeof listActiveKanbanColumns>>) : listActiveKanbanColumns(zaplotoId),
      isGerente ? getConsultorsByManager(userId) : Promise.resolve([] as Awaited<ReturnType<typeof getConsultorsByManager>>),
    ]);
    const tenantUserIds = profiles.map((p: any) => p.id);
    const profileById = new Map<string, any>(profiles.map((p: any) => [p.id, p]));
    const teamCaptadorIds = new Set(teamCaptadores.map((c) => c.id));

    // Card de vendas / atribuídos: só countWonSales (sem scan da tabela)
    if (salesOnly) {
      const captadorProfiles = isCaptador
        ? []
        : isGerente
          ? teamCaptadores
          : profiles.filter((p: any) => p.status === 'captador');
      const salesScopeIds = isCaptador
        ? [userId]
        : captadorProfiles.map((p: any) => p.id as string);
      const nameById = new Map<string, string>(
        captadorProfiles.map((p: any) => [p.id as string, (p.full_name || p.email || 'Captador') as string])
      );
      if (isCaptador) {
        nameById.set(userId, profile.full_name || profile.email || 'Captador');
      }
      const totalNaoAtribuidos = await countUnassignedLeads({
        isCaptador,
        isGerente,
        userId,
        zaplotoId,
        fromIso,
        toIso,
      });
      const sales = await countWonSales(salesScopeIds, nameById, totalNaoAtribuidos, { fromIso, toIso });
      return successResponse({ sales, period, date: periodDate || null });
    }

    const captadorFilter = isCaptador
      ? userId
      : isGerente
        ? (sp.get('captador_id') && teamCaptadorIds.has(sp.get('captador_id')!) ? sp.get('captador_id')! : undefined)
        : sp.get('captador_id') || undefined;

    // Não atribuídos + filtro de captador específico = conjunto vazio
    if (unassignedOnly && captadorFilter) {
      return successResponse({
        leads: [],
        total: 0,
        page: 1,
        page_size: PAGE_SIZE_DEFAULT,
        sales: includeSales
          ? { total_leads: 0, total_vendas: 0, taxa: 0, total_nao_atribuidos: 0, by_captador: [] }
          : undefined,
        columns,
        default_column_key: DEFAULT_ASSIGN_COLUMN,
        viewer: { status: profile.status, can_edit_column: true, can_assign: !isCaptador },
        gerentes: isCaptador
          ? []
          : isGerente
            ? [{ id: userId, name: profile.full_name || profile.email || 'Gerente' }]
            : profiles.filter((p: any) => p.status === 'gerente').map((p: any) => ({ id: p.id, name: p.full_name || p.email })),
        captadores: isCaptador
          ? [{ id: userId, name: profile.full_name || profile.email || 'Captador', enroller: profile.enroller }]
          : (isGerente ? teamCaptadores : profiles.filter((p: any) => p.status === 'captador')).map(
              (p: any) => ({ id: p.id, name: p.full_name || p.email, enroller: p.enroller })
            ),
      });
    }

    const rows = await scanLeads({
      tenantUserIds,
      zaplotoId,
      q: sp.get('q') || undefined,
      captureStatus: sp.get('capture_status') || undefined,
      gerenteId: isGerente || isCaptador ? undefined : sp.get('gerente_id') || undefined,
      captadorId: captadorFilter,
      fromIso,
      toIso,
      unassignedOnly,
      scopeGerenteId: isGerente ? userId : undefined,
      scopeTeamIds: isGerente ? [...teamCaptadorIds] : undefined,
      scopeCaptadorId: isCaptador ? userId : undefined,
      acquisitionTag: (sp.get('acquisition_tag') || '').trim() || undefined,
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

    if (columnFilter && !unassignedOnly) {
      const scopeForColumn = isCaptador
        ? [userId]
        : isGerente
          ? [...teamCaptadorIds]
          : profiles.filter((p: any) => p.status === 'captador').map((p: any) => p.id as string);
      const inColumn = await fetchLeadKeysInColumn(columnFilter, scopeForColumn);
      filtered = filtered.filter((r) => {
        if (!r.user_id) return false;
        return inColumn.has(`${String(r.external_id)}:${r.user_id}`);
      });
    } else if (unassignedOnly) {
      // Gerente: pool dele sem captador. Admin: sem gerente e sem captador.
      filtered = filtered.filter((r) => {
        if (r.user_id) return false;
        if (isGerente) return true;
        return !r.gerente_id;
      });
    }

    const total = filtered.length;
    const exportAll = sp.get('all') === '1';
    const pageSize = exportAll ? total : Math.min(200, Math.max(1, parseInt(sp.get('page_size') || `${PAGE_SIZE_DEFAULT}`, 10) || PAGE_SIZE_DEFAULT));
    const page = exportAll ? 1 : Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
    const paged = exportAll ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize);

    const columnTitleByKey = new Map(columns.map((c) => [c.key, c.title]));
    const stageMap = await fetchStagesByLeadUser(
      paged
        .filter((r) => r.user_id)
        .map((r) => ({ external_id: String(r.external_id), user_id: r.user_id as string }))
    );

    const leads = paged.map((r) => {
      const captador = r.user_id ? profileById.get(r.user_id) : null;
      const gerente = r.gerente_id
        ? profileById.get(r.gerente_id)
        : captador?.enroller
          ? profileById.get(captador.enroller)
          : null;
      const occ = occurrence.get(r.id);
      const columnKey = r.user_id ? stageMap.get(`${String(r.external_id)}:${r.user_id}`) || null : null;
      const rawName = [r.name, r.last_name].filter(Boolean).join(' ').trim() || null;
      const phoneDigitsOnly = String(r.phone || '').replace(/\D/g, '');
      const nameDigitsOnly = String(rawName || '').replace(/\D/g, '');
      const nameIsPhone =
        !!rawName &&
        !!phoneDigitsOnly &&
        (nameDigitsOnly === phoneDigitsOnly ||
          (/^\d{8,}$/.test(nameDigitsOnly) && !/[A-Za-zÀ-ÿ]/.test(rawName)));
      return {
        id: r.id,
        external_id: String(r.external_id),
        name: nameIsPhone ? null : rawName,
        phone: r.phone,
        email: r.email,
        capture_status: r.capture_status || 'pendente',
        column_key: columnKey,
        column_title: columnKey ? columnTitleByKey.get(columnKey) || columnKey : null,
        source: r.source,
        acquisition_tag: r.acquisition_tag || null,
        created_at: r.created_at,
        captador_id: r.user_id,
        captador_name: captador ? (captador.full_name || captador.email) : null,
        gerente_id: r.gerente_id || (gerente ? gerente.id : null),
        gerente_name: gerente ? (gerente.full_name || gerente.email) : null,
        occurrence: occ?.n || 1,
        occurrence_total: occ?.total || 1,
        unassigned: !r.user_id && !r.gerente_id,
        assignment_status: r.user_id
          ? 'atribuido'
          : r.gerente_id
            ? 'com_gerente'
            : 'nao_atribuido',
      };
    });

    const captadorProfiles = isCaptador
      ? []
      : isGerente
        ? teamCaptadores
        : profiles.filter((p: any) => p.status === 'captador');
    const salesScopeIds = isCaptador
      ? [userId]
      : captadorProfiles.map((p: any) => p.id as string);
    const nameById = new Map<string, string>(
      captadorProfiles.map((p: any) => [p.id as string, (p.full_name || p.email || 'Captador') as string])
    );
    if (isCaptador) {
      nameById.set(userId, profile.full_name || profile.email || 'Captador');
    }

    const sales = includeSales
      ? await countWonSales(
          salesScopeIds,
          nameById,
          await countUnassignedLeads({
            isCaptador,
            isGerente,
            userId,
            zaplotoId,
            fromIso,
            toIso,
          }),
          { fromIso, toIso }
        )
      : undefined;

    return successResponse({
      leads,
      total,
      page,
      page_size: pageSize,
      sales,
      columns,
      default_column_key: DEFAULT_ASSIGN_COLUMN,
      viewer: {
        status: profile.status,
        can_edit_column: true,
        can_assign: !isCaptador,
      },
      gerentes: isCaptador
        ? []
        : isGerente
          ? [{ id: userId, name: profile.full_name || profile.email || 'Gerente' }]
          : profiles
              .filter((p: any) => p.status === 'gerente')
              .map((p: any) => ({ id: p.id, name: p.full_name || p.email })),
      captadores: isCaptador
        ? [{ id: userId, name: profile.full_name || profile.email || 'Captador', enroller: profile.enroller }]
        : (isGerente ? teamCaptadores : profiles.filter((p: any) => p.status === 'captador')).map(
            (p: any) => ({
              id: p.id,
              name: p.full_name || p.email,
              enroller: p.enroller,
            })
          ),
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
    const { userId, profile } = await requireLeadsManagementAccess(req);
    if (profile.status === 'captador') {
      return errorResponse('Captador não pode cadastrar leads por esta tela.', 403);
    }
    const isGerente = profile.status === 'gerente';
    const zaplotoId = await getEffectiveZaplotoId(req, profile);
    const body = await req.json().catch(() => ({}));

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const phone = normalizePhone(body.phone);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : null;
    let gerenteId = body.gerente_id || null;
    // Somente o gerente vincula captador; admin só associa ao gerente.
    let captadorId = isGerente ? (body.captador_id || null) : null;
    // Coluna do kanban: gerente sempre usa Novo lead; só admin/super_admin podem escolher.
    const preferredColumnKey =
      !isGerente && typeof body.column_key === 'string' && body.column_key.trim()
        ? body.column_key.trim()
        : DEFAULT_ASSIGN_COLUMN;

    if (isGerente) {
      gerenteId = userId;
      if (captadorId) {
        const team = await getConsultorsByManager(userId);
        if (!team.some((c) => c.id === captadorId)) {
          return errorResponse('Captador fora da sua equipe.', 403);
        }
      }
    } else if (!gerenteId) {
      return errorResponse('Selecione o gerente para vincular o lead.', 400);
    }

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

    // Já atribuído a captador: entra no kanban dele (padrão: Novo lead)
    if (captadorId) {
      const column = await resolveKanbanColumn(zaplotoId, preferredColumnKey);
      if (!column) {
        return errorResponse('CRM sem colunas ativas para posicionar o lead no kanban.', 400);
      }
      try {
        await placeLeadsOnCaptadorKanban({
          leads: [{ id: inserted.id, external_id: inserted.external_id, user_id: null }],
          captadorId,
          movedBy: userId,
          column,
          nowIso,
        });
      } catch (e: any) {
        return errorResponse(e?.message || 'Erro ao posicionar no kanban.', 500);
      }
    }

    return successResponse({ id: inserted.id, external_id: String(inserted.external_id) }, 'Lead cadastrado com sucesso!');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * PATCH /api/admin/crm/leads — atualiza/atribui leads (aceita 1 ou vários ids).
 * Body: { ids: string[], capture_status?, gerente_id?, captador_id?, column_key? }
 * captador_id: '' remove o captador (lead volta ao pool); uuid atribui e envia ao kanban do captador.
 * column_key: coluna do kanban ao atribuir ou ao mover leads já atribuídos.
 */
export async function PATCH(req: NextRequest) {
  try {
    const { userId, profile } = await requireLeadsManagementAccess(req);
    const isCaptador = profile.status === 'captador';
    const isGerente = profile.status === 'gerente';
    const zaplotoId = await getEffectiveZaplotoId(req, profile);
    const body = await req.json().catch(() => ({}));

    const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: any) => typeof x === 'string') : [];
    if (ids.length === 0) return errorResponse('ids é obrigatório.', 400);
    if (ids.length > 500) return errorResponse('Máximo de 500 leads por operação.', 400);

    const hasStatus = typeof body.capture_status === 'string' && CAPTURE_STATUSES.includes(body.capture_status);
    const hasGerente = body.gerente_id !== undefined;
    const hasCaptador = body.captador_id !== undefined;
    const hasName = typeof body.name === 'string';
    const hasPhone = typeof body.phone === 'string';
    const hasEmail = typeof body.email === 'string';
    const requestedColumnKey =
      typeof body.column_key === 'string' && body.column_key.trim()
        ? body.column_key.trim()
        : '';
    const preferredColumnKey = requestedColumnKey;
    const hasColumn = Boolean(preferredColumnKey);
    // Captador: só pode trocar coluna dos próprios leads (paridade com o kanban).
    if (isCaptador) {
      if (!hasColumn || hasStatus || hasGerente || hasCaptador || hasName || hasPhone || hasEmail) {
        return errorResponse('Captador só pode alterar a coluna CRM dos próprios leads.', 403);
      }
    }
    if (!hasStatus && !hasGerente && !hasCaptador && !hasName && !hasPhone && !hasEmail && !hasColumn) {
      return errorResponse('Nada para atualizar.', 400);
    }
    if ((hasName || hasPhone || hasEmail) && ids.length !== 1) {
      return errorResponse('Editar nome/telefone/e-mail só pode ser feito em um lead por vez.', 400);
    }
    if (hasName && !body.name.trim()) {
      return errorResponse('Nome é obrigatório.', 400);
    }

    let leads: Awaited<ReturnType<typeof fetchLeadsByIds>>;
    try {
      leads = await fetchLeadsByIds(ids);
    } catch (e: any) {
      return errorResponse(e?.message || 'Erro ao buscar leads.', 400);
    }
    if (leads.length === 0) return errorResponse('Nenhum lead encontrado.', 400);

    if (isCaptador) {
      for (const lead of leads) {
        if (lead.user_id !== userId) {
          return errorResponse('Captador só pode mover leads atribuídos a você.', 403);
        }
      }
    } else if (isGerente) {
      const team = await getConsultorsByManager(userId);
      const teamIds = new Set(team.map((c) => c.id));
      for (const lead of leads) {
        const inScope =
          lead.gerente_id === userId ||
          (!!lead.user_id && teamIds.has(lead.user_id));
        if (!inScope) {
          return errorResponse('Lead fora do seu escopo.', 403);
        }
      }
      if (hasGerente && body.gerente_id && body.gerente_id !== userId) {
        return errorResponse('Gerente não pode reatribuir leads a outro gerente.', 403);
      }
    } else if (hasCaptador) {
      return errorResponse('Somente o gerente pode vincular leads a um captador.', 403);
    }

    const nowIso = new Date().toISOString();
    const captadorId = hasCaptador && isGerente ? (body.captador_id || null) : undefined;

    if (hasGerente && body.gerente_id) {
      const { data: g } = await supabaseServiceRole.from('profiles').select('id, status').eq('id', body.gerente_id).single();
      if (!g || g.status !== 'gerente') return errorResponse('Gerente inválido.', 400);
    }
    let captadorEnroller: string | null = null;
    if (hasCaptador && captadorId) {
      const { data: c } = await supabaseServiceRole.from('profiles').select('id, status, enroller').eq('id', captadorId).single();
      if (!c || c.status !== 'captador') return errorResponse('Captador inválido.', 400);
      if (c.enroller !== userId) {
        return errorResponse('Só é possível atribuir leads aos seus captadores.', 403);
      }
      captadorEnroller = c.enroller || null;
    }

    // Só troca de coluna (leads já atribuídos a captador)
    if (hasColumn && !hasCaptador && !hasGerente && !hasStatus && !hasName && !hasPhone && !hasEmail) {
      const column = await resolveKanbanColumn(zaplotoId, preferredColumnKey);
      if (!column) return errorResponse('Coluna do kanban inválida ou inativa.', 400);
      const withCaptador = leads.filter((l) => l.user_id);
      if (withCaptador.length === 0) {
        return errorResponse('Nenhum lead selecionado possui captador para mover no kanban.', 400);
      }
      const byCaptador = new Map<string, typeof withCaptador>();
      for (const lead of withCaptador) {
        const uid = lead.user_id!;
        const list = byCaptador.get(uid) || [];
        list.push(lead);
        byCaptador.set(uid, list);
      }
      try {
        for (const [ownerId, ownerLeads] of byCaptador) {
          await placeLeadsOnCaptadorKanban({
            leads: ownerLeads,
            captadorId: ownerId,
            movedBy: userId,
            column,
            nowIso,
          });
        }
      } catch (e: any) {
        return errorResponse(e?.message || 'Erro ao mover coluna no kanban.', 500);
      }
      return successResponse(
        { updated: withCaptador.length, column_key: column.key },
        `${withCaptador.length} lead(s) movido(s) para "${column.title}".`
      );
    }

    // Edição pontual (nome/telefone/e-mail) ou status isolado — 1 a 1
    if (hasName || hasPhone || hasEmail || (hasStatus && !hasGerente && !hasCaptador && !hasColumn)) {
      for (const lead of leads) {
        const update: Record<string, unknown> = { updated_at: nowIso, zaploto_id: zaplotoId };
        if (hasStatus) update.capture_status = body.capture_status;
        if (hasName) { update.name = body.name.trim(); update.last_name = null; }
        if (hasPhone) update.phone = normalizePhone(body.phone) || null;
        if (hasEmail) update.email = body.email.trim().toLowerCase() || null;
        const { error: upErr } = await supabaseServiceRole.from('crm_leads').update(update).eq('id', lead.id);
        if (upErr) return errorResponse(`Erro ao atualizar lead: ${upErr.message}`, 400);
      }
      return successResponse({ updated: leads.length }, 'Leads atualizados com sucesso!');
    }

    // Atribuição em massa (gerente e/ou captador)
    const leadUpdate: Record<string, unknown> = { updated_at: nowIso, zaploto_id: zaplotoId };
    if (hasStatus) leadUpdate.capture_status = body.capture_status;
    if (hasGerente) leadUpdate.gerente_id = isGerente ? userId : (body.gerente_id || null);
    if (hasCaptador) {
      leadUpdate.user_id = captadorId;
      leadUpdate.assigned_by = userId;
      leadUpdate.assigned_at = captadorId ? nowIso : null;
      if (!hasGerente && captadorId && captadorEnroller) leadUpdate.gerente_id = captadorEnroller;
    }

    for (const chunk of chunkArray(leads.map((l) => l.id), IN_CHUNK)) {
      const { error: upErr } = await supabaseServiceRole.from('crm_leads').update(leadUpdate).in('id', chunk);
      if (upErr) return errorResponse(`Erro ao atualizar leads: ${upErr.message}`, 400);
    }

    // Kanban: só do captador (admin/gerente não têm quadro operacional)
    // Gerente sempre posiciona em Novo lead; column_key customizado só via admin.
    if (hasCaptador && captadorId) {
      const column = await resolveKanbanColumn(zaplotoId, DEFAULT_ASSIGN_COLUMN);
      if (!column) {
        return errorResponse('CRM sem colunas ativas para posicionar os leads no kanban do captador.', 400);
      }
      try {
        await placeLeadsOnCaptadorKanban({
          leads,
          captadorId,
          movedBy: userId,
          column,
          nowIso,
        });
      } catch (e: any) {
        return errorResponse(e?.message || 'Erro ao posicionar no kanban.', 500);
      }
    } else if (hasCaptador && captadorId === null) {
      // Remove do kanban ao desatribuir captador
      for (const chunk of chunkArray(leads, IN_CHUNK)) {
        const byOwner = new Map<string, string[]>();
        for (const lead of chunk) {
          if (!lead.user_id) continue;
          const list = byOwner.get(lead.user_id) || [];
          list.push(String(lead.external_id));
          byOwner.set(lead.user_id, list);
        }
        for (const [ownerId, extIds] of byOwner) {
          for (const extChunk of chunkArray(extIds, IN_CHUNK)) {
            await supabaseServiceRole
              .from('crm_lead_stage')
              .delete()
              .eq('user_id', ownerId)
              .in('lead_external_id', extChunk);
          }
        }
      }
    }

    // Chat: sync em lote (só conversas já existentes)
    if (hasCaptador || hasGerente) {
      const chatUpdate: Record<string, unknown> = { updated_at: nowIso };
      if (hasCaptador) {
        chatUpdate.user_id = captadorId;
        chatUpdate.assigned_by = userId;
        chatUpdate.assigned_at = captadorId ? nowIso : null;
        chatUpdate.assignment_status = captadorId ? 'atribuido' : 'pendente';
      }
      if (hasGerente) chatUpdate.gerente_id = isGerente ? userId : (body.gerente_id || null);
      else if (hasCaptador && captadorEnroller) chatUpdate.gerente_id = captadorEnroller;

      for (const chunk of chunkArray(leads.map((l) => l.id), IN_CHUNK)) {
        await supabaseServiceRole.from('chat_conversations').update(chatUpdate).in('lead_id', chunk);
      }
    }

    return successResponse(
      { updated: leads.length, kanban: hasCaptador && captadorId ? leads.length : 0 },
      hasCaptador && captadorId
        ? `${leads.length} lead(s) no kanban do captador.`
        : 'Leads atualizados com sucesso!'
    );
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
    const { userId, profile } = await requireLeadsManagementAccess(req);
    if (profile.status === 'gerente' || profile.status === 'captador') {
      return errorResponse('Sem permissão para excluir leads.', 403);
    }
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
