import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getSubordinateIds, getUserProfile, type UserProfile } from '@/lib/middleware/permissions';
import { getHierarchyPath } from '@/lib/utils/hierarchy';
import { getUserIdsLinkedToCrmBancaViaUserBancas } from '@/lib/utils/user-bancas';
import { inferMetaCampaignIdsFromRedirectConsultors } from '@/lib/services/meta-redirect-consultor-attribution';

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

/**
 * Escopos de perfis que participam da agregação em "Meu Desempenho" por papel.
 * - consultor: só ele
 * - gerente: ele + consultores subordinados
 * - gestor: igual ao dono na mesma banca — gerentes + consultores da hierarquia do dono (via user_bancas)
 * - dono_banca: apenas gerentes + consultores subordinados (sem ele mesmo)
 * - admin/super_admin: todos os perfis (consultor/gerente/gestor/admin) da banca via user_bancas
 */
const SCOPE_ALLOWED_SUBORDINATE_STATUS: Record<string, string[]> = {
  consultor: [],
  gerente: ['consultor'],
  /** Legado / genérico; gestor usa bloco dedicado (escopo tipo dono). */
  gestor: ['consultor', 'gerente'],
  dono_banca: ['gerente', 'consultor'],
};

const SCOPE_INCLUDES_SELF: Record<string, boolean> = {
  consultor: true,
  gerente: true,
  gestor: true,
  dono_banca: false,
};

export type DashboardScopeResult = {
  allowed: boolean;
  reason?: string;
  userStatus: string | null;
  bancas: Array<{ id: string; name: string; url: string }>;
  defaultBancaUrl: string | null;
  consultantProfiles: ConsultantProfileBasic[];
  scopeLabel: string;
};

type BancaRowBasic = { id: string; name: string; url: string };

function normalizeBancaUrlForMatch(raw: string | null | undefined): string {
  return String(raw || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/api\/crm\/?/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

async function fetchBancaIdsFromUserBancas(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const { data } = await supabaseServiceRole
    .from('user_bancas')
    .select('banca_ids')
    .in('user_id', userIds);
  const set = new Set<string>();
  for (const row of data || []) {
    const arr = Array.isArray((row as any).banca_ids) ? ((row as any).banca_ids as string[]) : [];
    for (const id of arr) set.add(String(id));
  }
  return set;
}

async function fetchUserIdsInBanca(bancaId: string): Promise<string[]> {
  return getUserIdsLinkedToCrmBancaViaUserBancas(bancaId);
}

export type MeuDesempenhoVisibilityBundle = {
  profile: UserProfile | null;
  visibleBancas: BancaRowBasic[];
  /** Descendentes na hierarquia (enroller); reutilizar no escopo por banca para não chamar 2× */
  descendantIdsFromMe: string[];
};

/**
 * Uma passagem: perfil + bancas visíveis + IDs na árvore abaixo do usuário.
 * Evita duplicar getSubordinateIds entre lista de bancas e escopo por banca (dono/gerente).
 */
export async function getVisibleBancasAndDescendantIds(userId: string): Promise<MeuDesempenhoVisibilityBundle> {
  const profile = await getUserProfile(userId);
  if (!profile) {
    return { profile: null, visibleBancas: [], descendantIdsFromMe: [] };
  }

  const { data: allBancas } = await supabaseServiceRole
    .from('crm_bancas')
    .select('id, name, url')
    .order('name', { ascending: true });
  const bancas = (allBancas || []) as BancaRowBasic[];

  if (profile.status === 'admin' || profile.status === 'super_admin') {
    return { profile, visibleBancas: bancas, descendantIdsFromMe: [] };
  }

  const descendantIdsFromMe = await getSubordinateIds(userId);
  const targetUserIds = Array.from(new Set([userId, ...descendantIdsFromMe]));
  const allowedBancaIds = await fetchBancaIdsFromUserBancas(targetUserIds);

  return {
    profile,
    visibleBancas: bancas.filter((b) => allowedBancaIds.has(String(b.id))),
    descendantIdsFromMe,
  };
}

/**
 * Retorna a lista de bancas visíveis para o usuário no contexto de "Meu Desempenho".
 * - admin/super_admin: todas as bancas de crm_bancas.
 * - demais papéis: bancas em que o próprio usuário OU algum subordinado hierárquico atua
 *   (`user_bancas`). Isso cobre dono_banca (várias bancas), gerente, gestor e consultor.
 */
export async function getVisibleBancasForUser(userId: string): Promise<BancaRowBasic[]> {
  const { visibleBancas } = await getVisibleBancasAndDescendantIds(userId);
  return visibleBancas;
}

/**
 * Resolve o escopo completo de "Meu Desempenho" para um usuário numa banca específica.
 * Aplica as regras hierárquicas e retorna os perfis que devem ser agregados + metadados.
 */
export async function getDashboardScopeForUser(params: {
  userId: string;
  bancaUrl?: string | null;
  /** Quando já veio de GET /scope: evita 2× montar hierarquia + perfil */
  visibilityBundle?: MeuDesempenhoVisibilityBundle | null;
}): Promise<DashboardScopeResult> {
  const bundle =
    params.visibilityBundle ?? (await getVisibleBancasAndDescendantIds(params.userId));
  const profile = bundle.profile;
  if (!profile) {
    return {
      allowed: false,
      reason: 'user_not_found',
      userStatus: null,
      bancas: [],
      defaultBancaUrl: null,
      consultantProfiles: [],
      scopeLabel: '',
    };
  }

  const visibleBancas = bundle.visibleBancas;
  const descendantIdsFromMe = bundle.descendantIdsFromMe;
  const defaultBancaUrl = visibleBancas[0]?.url ?? null;

  const normalizedRequested = normalizeBancaUrlForMatch(params.bancaUrl);
  const selectedBanca =
    (normalizedRequested
      ? visibleBancas.find((b) => normalizeBancaUrlForMatch(b.url) === normalizedRequested)
      : null) || null;

  // Requisitou banca específica que o usuário não pode ver → bloqueia
  if (normalizedRequested && !selectedBanca) {
    return {
      allowed: false,
      reason: 'banca_out_of_scope',
      userStatus: profile.status ?? null,
      bancas: visibleBancas,
      defaultBancaUrl,
      consultantProfiles: [],
      scopeLabel: '',
    };
  }

  // Nenhuma banca exigida e usuário não tem nenhuma visível → retorna escopo vazio mas válido
  if (!selectedBanca) {
    return {
      allowed: true,
      userStatus: profile.status ?? null,
      bancas: visibleBancas,
      defaultBancaUrl,
      consultantProfiles: [],
      scopeLabel: 'Nenhuma banca selecionada',
    };
  }

  // admin/super_admin: agrega todos os perfis da banca via user_bancas
  if (profile.status === 'admin' || profile.status === 'super_admin') {
    const profiles = await getConsultorProfilesByBancaUrl(selectedBanca.url);
    return {
      allowed: true,
      userStatus: profile.status,
      bancas: visibleBancas,
      defaultBancaUrl,
      consultantProfiles: profiles,
      scopeLabel:
        profiles.length > 0
          ? `Todos os perfis da banca (${profiles.length})`
          : 'Banca sem perfis cadastrados',
    };
  }

  // Gestor de tráfego: mesmo conjunto que o dono na banca — subordinados do **dono** (gerentes + consultores).
  if (profile.status === 'gestor') {
    const [path, userIdsInBancaList] = await Promise.all([
      getHierarchyPath(params.userId),
      fetchUserIdsInBanca(selectedBanca.id),
    ]);
    const dono = path.find((p) => p.status === 'dono_banca');
    if (!dono) {
      return {
        allowed: true,
        userStatus: profile.status,
        bancas: visibleBancas,
        defaultBancaUrl,
        consultantProfiles: [],
        scopeLabel: 'Nenhum dono de banca na hierarquia',
      };
    }

    const allowedSubStatus = SCOPE_ALLOWED_SUBORDINATE_STATUS['dono_banca'];
    const includeSelf = SCOPE_INCLUDES_SELF['dono_banca'];
    const subordinateIds = await getSubordinateIds(dono.id);
    const userIdsInBanca = new Set(userIdsInBancaList);

    const candidateIds: string[] = [];
    if (includeSelf && userIdsInBanca.has(dono.id)) {
      candidateIds.push(dono.id);
    }
    if (subordinateIds.length > 0) {
      candidateIds.push(...subordinateIds.filter((id) => userIdsInBanca.has(id)));
    }

    const uniqueIds = Array.from(new Set(candidateIds));
    if (uniqueIds.length === 0) {
      return {
        allowed: true,
        userStatus: profile.status,
        bancas: visibleBancas,
        defaultBancaUrl,
        consultantProfiles: [],
        scopeLabel: 'Nenhum gerente ou consultor desta banca no escopo do dono',
      };
    }

    const roleDono = 'dono_banca';
    const { data: gestorProfiles } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, status')
      .in('id', uniqueIds)
      .in(
        'status',
        allowedSubStatus.length > 0
          ? Array.from(new Set([...(includeSelf ? [roleDono] : []), ...allowedSubStatus]))
          : [roleDono]
      );

    const consultantProfiles: ConsultantProfileBasic[] = (gestorProfiles || [])
      .filter((p: any) => Boolean(p.id) && Boolean(p.email))
      .map((p: any) => ({
        id: String(p.id),
        email: String(p.email),
        full_name: p.full_name ?? null,
        status: p.status ?? null,
      }));

    return {
      allowed: true,
      userStatus: profile.status,
      bancas: visibleBancas,
      defaultBancaUrl,
      consultantProfiles,
      scopeLabel:
        consultantProfiles.length > 0
          ? `Gerentes e consultores da rede (${consultantProfiles.length})`
          : 'Sem perfis elegíveis nesta banca',
    };
  }

  // Papéis hierárquicos: consultor, gerente, dono_banca
  const role = String(profile.status || 'consultor');
  const allowedSubStatus = SCOPE_ALLOWED_SUBORDINATE_STATUS[role] ?? [];
  const includeSelf = SCOPE_INCLUDES_SELF[role] ?? true;

  const subordinateIds =
    allowedSubStatus.length > 0 ? descendantIdsFromMe : [];
  const userIdsInBanca = new Set(await fetchUserIdsInBanca(selectedBanca.id));

  // Perfis candidatos = próprio (se o papel inclui) + subordinados filtrados por status
  const candidateIds: string[] = [];
  if (includeSelf && userIdsInBanca.has(params.userId)) {
    candidateIds.push(params.userId);
  }
  if (subordinateIds.length > 0) {
    candidateIds.push(...subordinateIds.filter((id) => userIdsInBanca.has(id)));
  }

  const uniqueIds = Array.from(new Set(candidateIds));
  if (uniqueIds.length === 0) {
    return {
      allowed: true,
      userStatus: profile.status,
      bancas: visibleBancas,
      defaultBancaUrl,
      consultantProfiles: [],
      scopeLabel: 'Nenhum perfil elegível no seu escopo para esta banca',
    };
  }

  const { data: profiles } = await supabaseServiceRole
    .from('profiles')
    .select('id, email, full_name, status')
    .in('id', uniqueIds)
    .in(
      'status',
      allowedSubStatus.length > 0
        ? Array.from(new Set([...(includeSelf ? [role] : []), ...allowedSubStatus]))
        : [role]
    );

  const consultantProfiles: ConsultantProfileBasic[] = (profiles || [])
    .filter((p: any) => Boolean(p.id) && Boolean(p.email))
    .map((p: any) => ({
      id: String(p.id),
      email: String(p.email),
      full_name: p.full_name ?? null,
      status: p.status ?? null,
    }));

  const labelByRole: Record<string, string> = {
    consultor: 'Seu desempenho',
    gerente: `Você + seus consultores (${consultantProfiles.length})`,
    gestor: `Você + seu time (${consultantProfiles.length})`,
    dono_banca: `Seus gerentes e consultores (${consultantProfiles.length})`,
  };

  return {
    allowed: true,
    userStatus: profile.status,
    bancas: visibleBancas,
    defaultBancaUrl,
    consultantProfiles,
    scopeLabel: labelByRole[role] || `Perfis no escopo (${consultantProfiles.length})`,
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

  const userIdsInBanca = await getUserIdsLinkedToCrmBancaViaUserBancas(String(banca.id));
  if (userIdsInBanca.length === 0) return [];

  const { data: profiles } = await supabaseServiceRole
    .from('profiles')
    .select('id, email, full_name, status')
    .in('id', userIdsInBanca)
    .in('status', ['consultor', 'gerente', 'admin', 'gestor', 'super_admin']);

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

  let explicitAttributionByCampaign = new Map<string, Set<string>>();
  try {
    const { data: attrRows, error: attrErr } = await supabaseServiceRole
      .from('meta_campaigns')
      .select('campaign_id, ads_attribution_consultor_id, ads_attribution_consultor_ids')
      .eq('banca_id', banca.id);
    if (!attrErr && Array.isArray(attrRows)) {
      for (const r of attrRows) {
        const cp = String((r as { campaign_id?: string }).campaign_id ?? '').trim();
        const row = r as {
          ads_attribution_consultor_ids?: string[] | null;
          ads_attribution_consultor_id?: string | null;
        };
        const fromArr = Array.isArray(row.ads_attribution_consultor_ids)
          ? row.ads_attribution_consultor_ids
          : [];
        const ids = new Set<string>();
        for (const x of fromArr) {
          const id = String(x ?? '').trim();
          if (id) ids.add(id);
        }
        if (ids.size === 0) {
          const leg = String(row.ads_attribution_consultor_id ?? '').trim();
          if (leg) ids.add(leg);
        }
        if (cp && ids.size > 0) explicitAttributionByCampaign.set(cp, ids);
      }
    } else if (attrErr && attrErr.code !== '42703') {
      console.warn('[MeuDesempenho/AdsSummary] meta_campaigns attribution:', attrErr.message);
    }
  } catch (e: unknown) {
    const err = e as { message?: string };
    console.warn('[MeuDesempenho/AdsSummary] attribution column skip:', err?.message);
  }

  const { data: campaignLinks } = await supabaseServiceRole
    .from('meta_campaign_consultors')
    .select('campaign_id, consultor_id')
    .eq('banca_id', banca.id)
    .in('consultor_id', consultorIds);

  const campaignIdSet = new Set<string>();
  for (const consultorId of consultorIds) {
    for (const [campId, attSet] of explicitAttributionByCampaign) {
      if (attSet.has(consultorId)) campaignIdSet.add(campId);
    }
    for (const row of campaignLinks ?? []) {
      if (String((row as { consultor_id: string }).consultor_id) !== consultorId) continue;
      const c = String((row as { campaign_id: string }).campaign_id ?? '').trim();
      if (!c) continue;
      const forced = explicitAttributionByCampaign.get(c);
      if (forced && !forced.has(consultorId)) continue;
      if (!forced) campaignIdSet.add(c);
    }
    let redirectForOne: string[] = [];
    try {
      redirectForOne = await inferMetaCampaignIdsFromRedirectConsultors(banca.id, [consultorId]);
    } catch (error: unknown) {
      const err = error as { message?: string };
      console.warn('[MeuDesempenho/AdsSummary] Falha ao inferir campanhas por redirect:', err?.message);
    }
    for (const campId of redirectForOne) {
      const forced = explicitAttributionByCampaign.get(campId);
      if (forced && !forced.has(consultorId)) continue;
      if (!forced) campaignIdSet.add(campId);
    }
  }

  const campaignIds = Array.from(campaignIdSet);

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

  const { data: vslProjects } = await supabaseServiceRole
    .from('vsl_projects')
    .select('id')
    .eq('banca_id', banca.id);
  const projectIds = Array.from(new Set((vslProjects || []).map((p: any) => String(p.id)).filter(Boolean)));

  let groupIds: string[] = [];
  if (projectIds.length > 0) {
    const { data: redirectGroups, error: redirectGroupsError } = await supabaseServiceRole
      .from('redirect_groups')
      .select('id')
      .in('project_id', projectIds)
      .in('consultant_user_id', consultorIds);
    if (redirectGroupsError) {
      console.warn('[MeuDesempenho/AdsSummary] Falha ao listar grupos por consultor:', redirectGroupsError.message);
    }
    groupIds = Array.from(new Set((redirectGroups || []).map((g: any) => String(g.id)).filter(Boolean)));
  }

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

