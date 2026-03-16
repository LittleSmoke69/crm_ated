import { NextRequest } from 'next/server';
import { requireStatusOrSidebarPermission } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { calculateLeadTemperature } from '@/lib/utils/temperature';

const STAR_LEVELS = [
  { level: 1, min: 100, max: 299 },
  { level: 2, min: 300, max: 699 },
  { level: 3, min: 700, max: 1199 },
  { level: 4, min: 1200, max: 4999 },
  { level: 5, min: 2500, max: 14999 },
  { level: 6, min: 15000, max: 29999 },
  { level: 7, min: 30000, max: 50000 },
] as const;

const INACTIVITY_DEADLINE_DAYS = 90;

function getMissingForNextStar(apostaEstrelas: number): number | null {
  const value = Math.max(0, apostaEstrelas ?? 0);
  const current = [...STAR_LEVELS].reverse().find((r) => value >= r.min && value <= r.max);
  if (!current) {
    if (value < STAR_LEVELS[0].min) return STAR_LEVELS[0].min - value;
    return null;
  }
  const currentIdx = STAR_LEVELS.findIndex((r) => r.level === current.level);
  const next = currentIdx < STAR_LEVELS.length - 1 ? STAR_LEVELS[currentIdx + 1] : null;
  return next ? Math.max(0, next.min - value) : null;
}

function isLeadPast90DaysInactivity(lead: { last_deposit_at?: string | null }): boolean {
  if (!lead.last_deposit_at) return false;
  const lastDeposit = new Date(lead.last_deposit_at);
  const deadline = new Date(lastDeposit);
  deadline.setDate(deadline.getDate() + INACTIVITY_DEADLINE_DAYS);
  return Date.now() >= deadline.getTime();
}

type FormattedLead = {
  id: string;
  last_deposit_at: string | null;
  total_depositado: number;
  total_depositos_count: number;
  aposta_estrelas: number;
  is_affiliate: boolean;
  temperature: string;
  status: string;
  name: string;
  email: string;
  phone: string;
  tags?: { id: string }[];
  [key: string]: any;
};

function applyExportFilters(
  leads: FormattedLead[],
  params: { get: (k: string) => string | null }
): FormattedLead[] {
  let result = leads;

  const onlyWithDeposit = params.get('only_with_deposit');
  if (onlyWithDeposit === '1') {
    result = result.filter((l) => (l.total_depositos_count || 0) >= 1);
  }

  const affiliate = params.get('affiliate');
  if (affiliate === 'yes') result = result.filter((l) => l.is_affiliate === true);
  else if (affiliate === 'no') result = result.filter((l) => !l.is_affiliate);

  const stars = params.get('stars');
  if (stars) {
    const num = parseInt(stars, 10);
    if (!isNaN(num)) result = result.filter((l) => (l.aposta_estrelas ?? 0) === num);
  }

  const value = params.get('value');
  const valueType = params.get('value_type');
  const valueMin = params.get('value_min');
  const valueMax = params.get('value_max');
  if (valueType === 'custom' && (valueMin || valueMax)) {
    const min = valueMin ? parseFloat(valueMin) : null;
    const max = valueMax ? parseFloat(valueMax) : null;
    result = result.filter((l) => {
      const val = l.total_depositado || 0;
      if (min != null && max != null) return val >= min && val <= max;
      if (min != null) return val >= min;
      if (max != null) return val <= max;
      return true;
    });
  } else if (value) {
    result = result.filter((l) => {
      const val = l.total_depositado || 0;
      if (value === 'none') return val === 0;
      if (value === 'low') return val > 0 && val < 10;
      if (value === 'medium') return val >= 10 && val < 100;
      if (value === 'high') return val >= 100 && val < 500;
      if (value === 'high_premium') return val >= 500 && val < 1000;
      if (value === 'ultra') return val >= 1000;
      return true;
    });
  }

  const valueNextStar = params.get('value_next_star');
  const valueNextStarType = params.get('value_next_star_type');
  const valueNextStarMin = params.get('value_next_star_min');
  const valueNextStarMax = params.get('value_next_star_max');
  if (valueNextStarType === 'custom' && (valueNextStarMin || valueNextStarMax)) {
    const min = valueNextStarMin ? parseFloat(valueNextStarMin) : null;
    const max = valueNextStarMax ? parseFloat(valueNextStarMax) : null;
    result = result.filter((l) => {
      const missing = getMissingForNextStar(l.aposta_estrelas ?? 0);
      if (missing === null) return false;
      if (min != null && max != null) return missing >= min && missing <= max;
      if (min != null) return missing >= min;
      if (max != null) return missing <= max;
      return true;
    });
  } else if (valueNextStar) {
    result = result.filter((l) => {
      const missing = getMissingForNextStar(l.aposta_estrelas ?? 0);
      if (valueNextStar === 'none') return missing === null;
      if (missing === null) return false;
      if (valueNextStar === 'low') return missing > 0 && missing < 50;
      if (valueNextStar === 'medium') return missing >= 50 && missing < 200;
      if (valueNextStar === 'high') return missing >= 200 && missing < 500;
      if (valueNextStar === 'ultra') return missing >= 500;
      return true;
    });
  }

  const lastDepositDate = params.get('last_deposit_date');
  if (lastDepositDate) {
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    let startDate: Date;
    let endDate: Date;
    if (lastDepositDate === 'hoje') {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      startDate = new Date(today);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(today);
      endDate.setHours(23, 59, 59, 999);
    } else {
      const days = parseInt(lastDepositDate, 10);
      if (days === 1) {
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 1);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        endDate.setDate(now.getDate() - 1);
        endDate.setHours(23, 59, 59, 999);
      } else if (days === 2) {
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 5);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        endDate.setDate(now.getDate() - 2);
        endDate.setHours(23, 59, 59, 999);
      } else if (days === 5) {
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 10);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        endDate.setDate(now.getDate() - 5);
        endDate.setHours(23, 59, 59, 999);
      } else if (days === 10) {
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 15);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        endDate.setDate(now.getDate() - 10);
        endDate.setHours(23, 59, 59, 999);
      } else if (days === 15) {
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 30);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        endDate.setDate(now.getDate() - 15);
        endDate.setHours(23, 59, 59, 999);
      } else if (days === 30) {
        startDate = new Date(0);
        endDate = new Date(now);
        endDate.setDate(now.getDate() - 30);
        endDate.setHours(23, 59, 59, 999);
      } else {
        startDate = new Date(0);
        endDate = new Date(now);
      }
    }
    result = result.filter((l) => {
      if (!l.last_deposit_at) return false;
      const depositDate = new Date(l.last_deposit_at);
      if (lastDepositDate === 'hoje') {
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const deposit = new Date(depositDate.getFullYear(), depositDate.getMonth(), depositDate.getDate());
        return today.getTime() === deposit.getTime();
      }
      return depositDate >= startDate && depositDate <= endDate;
    });
  }

  const temperature = params.get('temperature');
  if (temperature) {
    const t = temperature.toLowerCase();
    result = result.filter((l) => (l.temperature || '').toLowerCase() === t);
  }

  const classification = params.get('classification');
  if (classification) {
    result = result.filter((l) => {
      const isHighValue = (l.total_depositado || 0) >= 100;
      const isVIP = (l.total_depositos_count || 0) >= 3;
      const isOpportunity = (l.total_depositos_count || 0) === 2;
      const isAlert = l.status === 'deposito_sem_aposta' || l.status === 'deposito_sem_jogo';
      if (classification === 'high_value') return isHighValue;
      if (classification === 'vip') return isVIP;
      if (classification === 'oportunidade') return isOpportunity;
      if (classification === 'alerta') return isAlert;
      return false;
    });
  }

  const tagsParam = params.get('tags');
  if (tagsParam === '__has_any') {
    result = result.filter((l) => (l.tags || []).length > 0);
  } else if (tagsParam === '__none') {
    result = result.filter((l) => (l.tags || []).length === 0);
  } else if (tagsParam) {
    result = result.filter((l) => (l.tags || []).some((t: { id: string }) => t.id === tagsParam));
  }

  const possivelTransferencia = params.get('possivel_transferencia');
  if (possivelTransferencia === '1') {
    result = result.filter((l) => isLeadPast90DaysInactivity(l));
  }

  const search = params.get('search')?.trim();
  if (search) {
    const searchLower = search.toLowerCase();
    result = result.filter(
      (l) =>
        (l.name || '').toLowerCase().includes(searchLower) ||
        (l.email || '').toLowerCase().includes(searchLower) ||
        (l.phone || '').includes(search)
    );
  }

  return result;
}

/**
 * GET /api/dono-banca/crm-export
 * Exporta leads da banca página a página para geração de CSV.
 * Usa o mesmo endpoint externo que o CRM Kanban (get-indicateds-by-consultant),
 * mas sem filtrar por consultor — traz todos os leads da banca.
 *
 * Query params:
 *   banca_id  — obrigatório para admin/super_admin; ignorado para dono_banca (usa banca do perfil)
 *   from, to  — data inicial/final YYYY-MM-DD (opcional)
 *   page      — página (padrão 1)
 *   affiliate — yes | no
 *   stars     — 1..10 (estrelas)
 *   value     — none | low | medium | high | high_premium | ultra (ou value_type=custom + value_min/value_max)
 *   value_next_star — idem
 *   last_deposit_date — hoje | 1 | 2 | 5 | 10 | 15 | 30
 *   temperature, classification, tags, search, possivel_transferencia, only_with_deposit
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireStatusOrSidebarPermission(
      req,
      ['dono_banca', 'super_admin', 'admin'],
      'gestao_banca'
    );

    const { searchParams } = req.nextUrl;
    const bancaIdParam = searchParams.get('banca_id')?.trim() || null;
    const fromParam = searchParams.get('from') || null;
    const toParam = searchParams.get('to') || null;
    const pageParam = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);

    const isDonoBanca = profile?.status === 'dono_banca';

    // ── Resolve URL e nome da banca ──────────────────────────────────────────
    let rawBancaUrl: string | null = null;
    let bancaName: string | null = null;

    if (isDonoBanca) {
      const { data: donoProfile } = await supabaseServiceRole
        .from('profiles')
        .select('banca_url, banca_name')
        .eq('id', userId)
        .single();
      rawBancaUrl = donoProfile?.banca_url || null;
      bancaName = donoProfile?.banca_name || null;
    } else {
      if (!bancaIdParam) {
        return errorResponse('Informe banca_id para exportar os leads.', 400);
      }
      const { data: banca } = await supabaseServiceRole
        .from('crm_bancas')
        .select('url, name')
        .eq('id', bancaIdParam)
        .single();
      if (!banca?.url) return errorResponse('Banca não encontrada.', 404);
      rawBancaUrl = banca.url;
      bancaName = banca.name || null;
    }

    if (!rawBancaUrl) {
      return errorResponse('URL da banca não configurada no perfil.', 400);
    }

    const apiKey = process.env.CRM_API_KEY;
    if (!apiKey) return errorResponse('Chave de API do CRM não configurada no servidor.', 500);

    // Normaliza URL exatamente como o /api/crm/leads
    function normalizeBancaUrl(raw: string): string {
      let u = raw.trim().replace(/^https?:\/\//i, '').replace(/\/api\/crm\/?/i, '').replace(/\/+$/, '').trim();
      return u ? `https://${u}` : '';
    }

    const cleanBancaUrl = normalizeBancaUrl(rawBancaUrl);
    const cleanApiKey = apiKey.trim().replace(/\s+/g, '');
    const perPage = 2000;

    // ── Emails dos consultores/gerentes da banca (mesma forma que o CRM: consultant=email) ──
    let consultantEmails: string[] = [];
    if (isDonoBanca) {
      const { data: donoProfileFull } = await supabaseServiceRole
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .single();
      if (donoProfileFull?.id) {
        const { data: gerentes } = await supabaseServiceRole
          .from('profiles')
          .select('id, email')
          .eq('enroller', donoProfileFull.id)
          .eq('status', 'gerente');
        const gerenteIds = (gerentes || []).map((g: { id: string }) => g.id);
        for (const g of gerentes || []) {
          if (g.email?.trim()) consultantEmails.push(g.email.trim());
        }
        const { data: consultores } = await supabaseServiceRole
          .from('profiles')
          .select('id, email')
          .in('enroller', gerenteIds)
          .eq('status', 'consultor');
        for (const c of consultores || []) {
          if (c.email?.trim()) consultantEmails.push(c.email.trim());
        }
      }
    } else if (bancaIdParam) {
      const { data: userBancas } = await supabaseServiceRole
        .from('user_bancas')
        .select('user_id')
        .filter('banca_ids', 'cs', JSON.stringify([bancaIdParam]));
      const userIds = (userBancas || []).map((r: { user_id: string }) => r.user_id);
      if (userIds.length > 0) {
        const { data: profiles } = await supabaseServiceRole
          .from('profiles')
          .select('id, email, status')
          .in('id', userIds);
        for (const p of profiles || []) {
          if (p.email?.trim()) consultantEmails.push(p.email.trim());
        }
      }
    }

    const rawLeads: any[] = [];
    let hasMore = false;

    if (consultantEmails.length > 0) {
      // Uma chamada get-indicateds-by-consultant por consultor (consultant=email), página pageParam; mescla resultados
      for (const email of consultantEmails) {
        const params = new URLSearchParams();
        params.set('consultant', email.trim());
        params.set('per_page', String(perPage));
        params.set('page', String(pageParam));
        params.set('sort', 'created_at');
        params.set('direction', 'desc');
        if (fromParam) params.set('from', fromParam);
        if (toParam) params.set('to', toParam);
        const externalUrl = `${cleanBancaUrl}/api/crm/get-indicateds-by-consultant?${params.toString()}`;
        try {
          const response = await fetch(externalUrl, {
            method: 'GET',
            headers: { 'X-API-KEY': cleanApiKey, Accept: 'application/json' },
            signal: AbortSignal.timeout(60000),
          });
          if (!response.ok) continue;
          const result = await response.json();
          if (result?.success && Array.isArray(result.data)) {
            rawLeads.push(...result.data);
            if (result.data.length >= perPage) hasMore = true;
          }
        } catch (_) {
          // ignora falha em um consultor e segue
        }
      }
      console.log(`[CRM Export] page=${pageParam} | banca=${bancaName ?? rawBancaUrl} | consultants=${consultantEmails.length} | leads=${rawLeads.length} | has_more=${hasMore}`);
    } else {
      // Fallback: uma única chamada sem consultant (comportamento antigo)
      const params = new URLSearchParams();
      params.set('per_page', String(perPage));
      params.set('page', String(pageParam));
      params.set('sort', 'created_at');
      params.set('direction', 'desc');
      if (fromParam) params.set('from', fromParam);
      if (toParam) params.set('to', toParam);
      const externalUrl = `${cleanBancaUrl}/api/crm/get-indicateds-by-consultant?${params.toString()}`;
      let response: Response;
      try {
        response = await fetch(externalUrl, {
          method: 'GET',
          headers: { 'X-API-KEY': cleanApiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(60000),
        });
      } catch (fetchErr: any) {
        if (fetchErr.name === 'AbortError') {
          return errorResponse('Timeout ao conectar com a API da banca.', 504);
        }
        return errorResponse(`Erro de rede ao conectar com a banca: ${fetchErr.message}`);
      }
      if (!response.ok) {
        if (response.status === 404) {
          return successResponse([], { meta: { page: pageParam, has_more: false, total_in_page: 0 } });
        }
        return errorResponse(`API da banca retornou ${response.status} ${response.statusText}`, response.status);
      }
      const result = await response.json();
      if (!result?.success || !Array.isArray(result.data)) {
        return errorResponse(result?.message || 'Formato de resposta inválido da API da banca.');
      }
      rawLeads.push(...result.data);
      hasMore = rawLeads.length >= perPage;
      console.log(`[CRM Export] page=${pageParam} | banca=${bancaName ?? rawBancaUrl} | from=${fromParam ?? '-'} to=${toParam ?? '-'}`);
    }

    // ── Aplica os mesmos filtros do /api/crm/leads ───────────────────────────

    // 1. Filtra data (fuso São Paulo, idêntico ao CRM Kanban)
    let leads = rawLeads;
    if (fromParam || toParam) {
      const saoPauloTimeZone = 'America/Sao_Paulo';
      leads = leads.filter((lead: any) => {
        if (!lead.created_at) return false;
        const leadDate = new Date(lead.created_at);
        const leadDateSP = new Date(leadDate.toLocaleString('en-US', { timeZone: saoPauloTimeZone }));
        const leadDateStr = leadDateSP.toISOString().split('T')[0];
        if (fromParam && leadDateStr < fromParam) return false;
        if (toParam && leadDateStr > toParam) return false;
        return true;
      });
    }

    // 2. Filtra clientes fantasma (idêntico ao CRM Kanban)
    leads = leads.filter((lead: any) => {
      const totalDepositado = parseFloat(lead.total_depositado) || 0;
      const totalApostado = parseFloat(lead.total_apostado) || 0;
      const totalGanho = parseFloat(lead.total_ganho) || 0;
      const totalDepositosCount = parseInt(lead.total_depositos_count) || 0;
      const isGhost =
        totalDepositado === 0 && totalApostado === 0 && totalGanho === 0 && totalDepositosCount === 1;
      return !isGhost;
    });

    // ── Formata leads (mesmos campos do /api/crm/leads + consultor) ──────────
    const formattedLeads = leads.map((l: any) => {
      const temperature = calculateLeadTemperature({
        created_at: l.created_at || new Date().toISOString(),
        total_depositos_count: parseInt(l.total_depositos_count) || 0,
        last_deposit_at: l.last_deposit_at || null,
      });
      return {
        id: l.id,
        consultant_name: l.consultant_name || '',
        consultant_email: l.consultant_email || '',
        name: l.name || '',
        last_name: l.last_name || '',
        phone: l.phone || '',
        email: l.email || '',
        status: l.status || 'novo',
        temperature,
        banca_name: bancaName,
        total_depositado: Math.round((parseFloat(l.total_depositado) || 0) * 100) / 100,
        total_apostado: Math.round((parseFloat(l.total_apostado) || 0) * 100) / 100,
        total_ganho: parseFloat(l.total_ganho) || 0,
        total_depositos_count: parseInt(l.total_depositos_count) || 0,
        total_saque: l.total_saque != null ? Math.round((parseFloat(l.total_saque) || 0) * 100) / 100 : null,
        balance: Math.round((parseFloat(l.balance) || 0) * 100) / 100,
        available_withdraw:
          l.available_withdraw != null
            ? Math.round((parseFloat(String(l.available_withdraw)) || 0) * 100) / 100
            : null,
        bonus: Math.round((parseFloat(l.bonus) || 0) * 100) / 100,
        aposta_estrelas: parseInt(l.aposta_estrelas) || 0,
        is_affiliate:
          !!l.affiliate_name ||
          l.is_affiliate === true ||
          l.affiliate === 'yes' ||
          l.affiliate_filter === 'yes',
        affiliate_name: l.affiliate_name || null,
        created_at: l.created_at || null,
        last_deposit_at: l.last_deposit_at || null,
        last_deposit_value: l.last_deposit_value
          ? Math.round((parseFloat(l.last_deposit_value) || 0) * 100) / 100
          : null,
        last_winner_at: l.last_winner_at || null,
        last_winner_value: l.last_winner_value
          ? Math.round((parseFloat(l.last_winner_value) || 0) * 100) / 100
          : null,
        last_interaction: l.last_interaction || null,
        transferred: l.transferred === true || l.transferred === 'true' || l.transferred === 1,
        tags: l.tags || [],
      };
    });

    const filteredLeads = applyExportFilters(formattedLeads, searchParams);

    console.log(`[CRM Export] 200 OK | page=${pageParam} | leads=${filteredLeads.length} | has_more=${hasMore}`);
    return successResponse(filteredLeads, {
      meta: { page: pageParam, has_more: hasMore, total_in_page: filteredLeads.length },
    });
  } catch (err: any) {
    console.error('[CRM Export] Erro:', err?.message);
    if (
      err.message?.includes('Acesso negado') ||
      err.message?.includes('Não autenticado') ||
      err.message?.includes('Usuário inválido')
    ) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
