import { supabaseServiceRole } from '@/lib/services/supabase-service';

const CRM_BETS_DEPOSITS_ENDPOINT =
  'https://web.rodadafortuna.digital/api/crm/get-bets-and-deposits-by-consultant';
const BETS_DEPOSITS_LOG_PREFIX = '[BetsDeposits API]';
const BETS_DEPOSITS_MAX_429_RETRIES = 4;
const BETS_DEPOSITS_RETRY_DELAYS_MS = [2000, 5000, 10000, 20000];

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function normalizeCrmBaseUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = String(raw)
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/api\/crm\/?/i, '')
    .replace(/\/+$/, '')
    .trim();
  if (!normalized) return null;
  return `https://${normalized}`;
}

function resolveBetsDepositsEndpoint(bancaUrl?: string | null): string {
  const base = normalizeCrmBaseUrl(bancaUrl);
  if (!base) return CRM_BETS_DEPOSITS_ENDPOINT;
  return `${base}/api/crm/get-bets-and-deposits-by-consultant`;
}

function toDdMmYyyy(isoDate?: string | null): string | null {
  if (!isoDate) return null;
  const parts = String(isoDate).trim().split('-');
  if (parts.length !== 3) return null;
  const [year, month, day] = parts;
  if (!year || !month || !day) return null;
  return `${day}-${month}-${year}`;
}

function parsePtBrMoney(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? '')
    .trim()
    .replace(/\./g, '')
    .replace(',', '.');
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function formatPtBrMoney(value: number): string {
  return value.toFixed(2).replace('.', ',');
}

export interface ConsultantProfileBasic {
  id: string;
  email: string;
  full_name: string | null;
  status?: string | null;
}

export interface BetsAndDepositsApiResponse {
  success: boolean;
  message?: string;
  data?: any;
}

export async function fetchBetsDepositsByConsultant(params: {
  consultantEmail: string;
  bancaUrl?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  page?: number;
  perPage?: number;
}): Promise<BetsAndDepositsApiResponse | null> {
  const apiKey = process.env.CRM_API_KEY;
  if (!apiKey) {
    console.log(`${BETS_DEPOSITS_LOG_PREFIX} CRM_API_KEY not set`);
    return null;
  }

  const endpoint = resolveBetsDepositsEndpoint(params.bancaUrl);
  const consultant = String(params.consultantEmail || '').trim().replace(/[\r\n]/g, '');
  const page = String(params.page ?? 1);
  const perPage = String(params.perPage ?? 200);
  const from = toDdMmYyyy(params.dateFrom);
  const to = toDdMmYyyy(params.dateTo);
  const rawQueryParts = [`consultant=${consultant}`, `page=${page}`, `per_page=${perPage}`];
  if (from) rawQueryParts.push(`from=${from}`);
  if (to) rawQueryParts.push(`to=${to}`);

  // Mantem os parametros "raw" para facilitar debug com provedores que tratam mal caracteres codificados.
  const rawUrl = `${endpoint}?${rawQueryParts.join('&')}`;
  const encodedUrl = new URL(endpoint);
  encodedUrl.searchParams.set('consultant', consultant);
  encodedUrl.searchParams.set('page', page);
  encodedUrl.searchParams.set('per_page', perPage);
  if (from) encodedUrl.searchParams.set('from', from);
  if (to) encodedUrl.searchParams.set('to', to);

  try {
    console.log(`${BETS_DEPOSITS_LOG_PREFIX} Request start`, {
      endpoint,
      consultant,
      page,
      perPage,
      from: from ?? null,
      to: to ?? null,
    });
    console.log(`${BETS_DEPOSITS_LOG_PREFIX} URL(raw): ${rawUrl}`);
    for (let attempt = 0; attempt <= BETS_DEPOSITS_MAX_429_RETRIES; attempt++) {
      let response = await fetch(rawUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-API-KEY': apiKey,
        },
        signal: AbortSignal.timeout(60000),
      });
      // Fallback de compatibilidade para casos em que o servidor exige query string codificada.
      if (!response.ok) {
        console.log(`${BETS_DEPOSITS_LOG_PREFIX} Raw request failed`, {
          status: response.status,
          statusText: response.statusText,
          attempt,
        });
        console.log(`${BETS_DEPOSITS_LOG_PREFIX} URL(encoded): ${encodedUrl.toString()}`);
        response = await fetch(encodedUrl.toString(), {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'X-API-KEY': apiKey,
          },
          signal: AbortSignal.timeout(60000),
        });
      }

      if (response.ok) {
        const json = (await response.json()) as BetsAndDepositsApiResponse;
        console.log(`${BETS_DEPOSITS_LOG_PREFIX} Request success`, {
          success: Boolean(json?.success),
          hasData: Boolean(json?.data),
          message: json?.message ?? null,
          attempt,
        });
        return json;
      }

      if (response.status === 429 && attempt < BETS_DEPOSITS_MAX_429_RETRIES) {
        const baseDelay = BETS_DEPOSITS_RETRY_DELAYS_MS[attempt] ?? BETS_DEPOSITS_RETRY_DELAYS_MS.at(-1) ?? 20000;
        const jitter = Math.round(baseDelay * 0.2 * (Math.random() * 2 - 1));
        const waitMs = Math.max(500, baseDelay + jitter);
        console.log(`${BETS_DEPOSITS_LOG_PREFIX} 429 detected, waiting before retry`, {
          attempt: `${attempt + 1}/${BETS_DEPOSITS_MAX_429_RETRIES}`,
          waitMs,
        });
        await sleep(waitMs);
        continue;
      }

      const responseBody = await response.text();
      console.log(`${BETS_DEPOSITS_LOG_PREFIX} Request failed after fallback`, {
        status: response.status,
        statusText: response.statusText,
        responseBody: responseBody.slice(0, 500),
        attempt,
      });
      return null;
    }

    return null;
  } catch (error: any) {
    console.log(`${BETS_DEPOSITS_LOG_PREFIX} Request error`, {
      message: error?.message ?? 'unknown_error',
    });
    return null;
  }
}

function mergeBetUserRow(
  acc: Map<number, any>,
  row: {
    user_id_sender: number;
    user_name?: string;
    user_email?: string;
    total_apostado?: number;
    total_apostado_loteria?: number;
    total_apostado_bichao?: number;
    bets_count_loteria?: number;
    bets_count_bichao?: number;
  }
) {
  const current = acc.get(row.user_id_sender) ?? {
    user_id_sender: row.user_id_sender,
    user_name: row.user_name ?? '',
    user_email: row.user_email ?? '',
    total_apostado: 0,
    total_apostado_loteria: 0,
    total_apostado_bichao: 0,
    bets_count_loteria: 0,
    bets_count_bichao: 0,
  };
  current.total_apostado += Number(row.total_apostado || 0);
  current.total_apostado_loteria += Number(row.total_apostado_loteria || 0);
  current.total_apostado_bichao += Number(row.total_apostado_bichao || 0);
  current.bets_count_loteria += Number(row.bets_count_loteria || 0);
  current.bets_count_bichao += Number(row.bets_count_bichao || 0);
  if (!current.user_name && row.user_name) current.user_name = row.user_name;
  if (!current.user_email && row.user_email) current.user_email = row.user_email;
  acc.set(row.user_id_sender, current);
}

function mergeDepositUserRow(
  acc: Map<number, any>,
  row: {
    user_id_sender: number;
    user_name?: string;
    user_email?: string;
    total_depositado?: number;
    deposits_count?: number;
  }
) {
  const current = acc.get(row.user_id_sender) ?? {
    user_id_sender: row.user_id_sender,
    user_name: row.user_name ?? '',
    user_email: row.user_email ?? '',
    total_depositado: 0,
    deposits_count: 0,
  };
  current.total_depositado += Number(row.total_depositado || 0);
  current.deposits_count += Number(row.deposits_count || 0);
  if (!current.user_name && row.user_name) current.user_name = row.user_name;
  if (!current.user_email && row.user_email) current.user_email = row.user_email;
  acc.set(row.user_id_sender, current);
}

export function aggregateBetsDepositsPayload(items: Array<{ profile: ConsultantProfileBasic; payload: any }>) {
  let totalApostas = 0;
  let totalDepositos = 0;
  let totalComissao = 0;

  const commissionByType: any[] = [];
  const betsByUser = new Map<number, any>();
  const depositsByUser = new Map<number, any>();

  for (const item of items) {
    const data = item.payload?.data;
    if (!data) continue;
    totalApostas += parsePtBrMoney(data?.totals?.total_apostas);
    totalDepositos += parsePtBrMoney(data?.totals?.total_depositos);
    totalComissao += parsePtBrMoney(data?.totals?.total_comissao);

    const commissionRows = Array.isArray(data?.commission_by_type) ? data.commission_by_type : [];
    for (const row of commissionRows) {
      commissionByType.push({
        ...row,
        consultant_email: item.profile.email,
        consultant_name: item.profile.full_name,
      });
    }

    const betsRows = data?.history?.bets_by_user?.data;
    if (Array.isArray(betsRows)) {
      for (const row of betsRows) mergeBetUserRow(betsByUser, row);
    }

    const depositsRows = data?.history?.deposits_by_user?.data;
    if (Array.isArray(depositsRows)) {
      for (const row of depositsRows) mergeDepositUserRow(depositsByUser, row);
    }
  }

  commissionByType.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  const betsData = [...betsByUser.values()].sort((a, b) => Number(b.total_apostado || 0) - Number(a.total_apostado || 0));
  const depositsData = [...depositsByUser.values()].sort(
    (a, b) => Number(b.total_depositado || 0) - Number(a.total_depositado || 0)
  );

  return {
    consultant_scope: {
      type: items.length > 1 ? 'multi' : 'single',
      count: items.length,
      consultants: items.map((x) => ({
        id: x.profile.id,
        email: x.profile.email,
        full_name: x.profile.full_name,
      })),
    },
    totals: {
      total_apostas: formatPtBrMoney(totalApostas),
      total_depositos: formatPtBrMoney(totalDepositos),
      total_comissao: formatPtBrMoney(totalComissao),
    },
    commission_by_type: commissionByType,
    history: {
      bets_by_user: {
        pagination: {
          current_page: 1,
          per_page: betsData.length,
          total: betsData.length,
          last_page: 1,
        },
        data: betsData,
      },
      deposits_by_user: {
        pagination: {
          current_page: 1,
          per_page: depositsData.length,
          total: depositsData.length,
          last_page: 1,
        },
        data: depositsData,
      },
    },
  };
}

export async function getConsultorProfilesByBancaUrl(bancaUrl: string): Promise<ConsultantProfileBasic[]> {
  const normalized = String(bancaUrl || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/api\/crm\/?/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  if (!normalized) return [];

  const { data: bancas } = await supabaseServiceRole.from('crm_bancas').select('id, url');
  const banca = (bancas || []).find((b: any) => {
    const url = String(b.url || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/api\/crm\/?/i, '')
      .replace(/\/+$/, '')
      .toLowerCase();
    return url === normalized;
  });
  if (!banca?.id) return [];

  const { data: userBancasRows } = await supabaseServiceRole
    .from('user_bancas')
    .select('user_id')
    .filter('banca_ids', 'cs', JSON.stringify([banca.id]));
  const userIdsInBanca = (userBancasRows || []).map((r: { user_id: string }) => r.user_id);
  if (userIdsInBanca.length === 0) return [];

  const { data: profiles } = await supabaseServiceRole
    .from('profiles')
    .select('id, email, full_name, status')
    .in('id', userIdsInBanca)
    .in('status', ['consultor', 'gerente', 'admin', 'gestor']);

  return (profiles || [])
    .filter((p: any) => Boolean(p.id) && Boolean(p.email))
    .map((p: any) => ({
      id: String(p.id),
      email: String(p.email),
      full_name: p.full_name ?? null,
      status: p.status ?? null,
    }));
}

export async function computeConsultantAdsSummary(params: {
  bancaUrl: string | null | undefined;
  consultorIds: string[];
  dateFrom?: string | null;
  dateTo?: string | null;
}) {
  const consultorIds = Array.from(new Set((params.consultorIds || []).map((x) => String(x).trim()).filter(Boolean)));
  if (consultorIds.length === 0 || !params.bancaUrl) {
    return {
      total_spend: 0,
      meta_spend: 0,
      redirect_spend: 0,
      redirect_clicks: 0,
      source: 'none' as 'none' | 'meta_ads' | 'redirect',
    };
  }

  const normalized = String(params.bancaUrl || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/api\/crm\/?/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();

  const { data: bancas } = await supabaseServiceRole.from('crm_bancas').select('id, url');
  const banca = (bancas || []).find((b: any) => {
    const url = String(b.url || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/api\/crm\/?/i, '')
      .replace(/\/+$/, '')
      .toLowerCase();
    return url === normalized;
  });
  if (!banca?.id) {
    return {
      total_spend: 0,
      meta_spend: 0,
      redirect_spend: 0,
      redirect_clicks: 0,
      source: 'none' as 'none' | 'meta_ads' | 'redirect',
    };
  }

  const { data: campaignLinks } = await supabaseServiceRole
    .from('meta_campaign_consultors')
    .select('campaign_id')
    .eq('banca_id', banca.id)
    .in('consultor_id', consultorIds);
  const campaignIds = Array.from(new Set((campaignLinks || []).map((x: any) => String(x.campaign_id)).filter(Boolean)));

  let metaSpend = 0;
  if (campaignIds.length > 0) {
    let query = supabaseServiceRole
      .from('meta_insights_daily')
      .select('spend')
      .eq('banca_id', banca.id)
      .in('campaign_id', campaignIds);
    if (params.dateFrom) query = query.gte('date', params.dateFrom);
    if (params.dateTo) query = query.lte('date', params.dateTo);
    const { data: insights } = await query;
    metaSpend = (insights || []).reduce((sum: number, row: any) => sum + (Number(row.spend) || 0), 0);
  }

  const { data: redirectGroups } = await supabaseServiceRole
    .from('redirect_groups')
    .select('id')
    .in('consultant_user_id', consultorIds);
  const groupIds = Array.from(new Set((redirectGroups || []).map((g: any) => String(g.id)).filter(Boolean)));

  let redirectClicks = 0;
  if (groupIds.length > 0) {
    let q = supabaseServiceRole
      .from('redirect_clicks')
      .select('id', { count: 'exact', head: true })
      .in('group_id', groupIds);
    if (params.dateFrom) q = q.gte('selected_at', `${params.dateFrom}T00:00:00.000Z`);
    if (params.dateTo) q = q.lte('selected_at', `${params.dateTo}T23:59:59.999Z`);
    const { count } = await q;
    redirectClicks = count ?? 0;
  }

  const redirectSpend = 0;
  const totalSpend = metaSpend + redirectSpend;
  const source: 'none' | 'meta_ads' | 'redirect' = metaSpend > 0 ? 'meta_ads' : redirectClicks > 0 ? 'redirect' : 'none';

  return {
    total_spend: totalSpend,
    meta_spend: metaSpend,
    redirect_spend: redirectSpend,
    redirect_clicks: redirectClicks,
    source,
  };
}

