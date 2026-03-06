import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile, UserProfile, canAccessUser } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export type BancaRow = { id: string; name: string; url: string };

/** Nome da banca que não deve entrar na busca de consultores nem na lista de bancas do CRM. */
const NOME_BANCA_EXCLUIDA_BUSCA = 'Sua banca';

/** TTL do cache em memória (ms). Mesma requisição (userId + perfil) dentro do TTL retorna do cache. */
const BANCAS_CACHE_TTL_MS = 90_000;
/** Máximo de chamadas externas simultâneas (evita estourar conexões e rate limit). */
const EXTERNAL_API_CONCURRENCY = 10;

const bancasCache = new Map<string, { data: BancaRow[]; expires: number }>();
/** Evita requisições duplicadas: mesma cacheKey em paralelo reutiliza a mesma Promise. */
const bancasInFlight = new Map<string, Promise<BancaRow[]>>();

function getCachedBancas(cacheKey: string): BancaRow[] | null {
  const entry = bancasCache.get(cacheKey);
  if (!entry || Date.now() > entry.expires) return null;
  return entry.data;
}

function setCachedBancas(cacheKey: string, data: BancaRow[]): void {
  if (bancasCache.size >= 500) {
    const now = Date.now();
    for (const [k, v] of bancasCache.entries()) if (v.expires <= now) bancasCache.delete(k);
  }
  bancasCache.set(cacheKey, { data, expires: Date.now() + BANCAS_CACHE_TTL_MS });
}

/**
 * Executa chamadas assíncronas em lotes para limitar concorrência.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    results.push(...(await Promise.all(chunk.map(fn))));
  }
  return results;
}

function excluirBancaPorNome(bancas: BancaRow[], nomeExcluir: string): BancaRow[] {
  const lower = nomeExcluir.trim().toLowerCase();
  if (!lower) return bancas;
  return bancas.filter(b => (b.name ?? '').trim().toLowerCase() !== lower);
}

/**
 * Normaliza a URL da banca (domínio) para base com https.
 */
function normalizarUrlBanca(raw: string): string {
  let u = raw.trim();
  u = u.replace(/^https?:\/\//i, '');
  u = u.replace(/\/api\/crm\/?/i, '');
  u = u.replace(/\/+$/, '').trim();
  if (!u) return '';
  return u.startsWith('http') ? u : `https://${u}`;
}

/** Monta o curl completo para reprodução (sem mascarar dados). */
function buildCurlExample(method: string, url: string, apiKey: string): string {
  const key = (apiKey || '').trim();
  return `curl -s -X ${method} "${url}" -H "X-API-KEY: ${key || 'YOUR_API_KEY'}" -H "Accept: application/json"`;
}

/** Chama get-indicateds-by-consultant na URL e retorna status e corpo da resposta. */
async function fetchGetIndicatedsResponse(
  url: string,
  apiKey: string
): Promise<{ status: number; body: string }> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'X-API-KEY': (apiKey || '').trim(), Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.text();
    return { status: res.status, body };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: -1, body: `Erro: ${msg}` };
  }
}

/**
 * Chama a API user-consultant-info na URL da banca para um email.
 * Retorna o corpo da resposta (sucesso, existe, usuario, etc.) ou null em caso de erro.
 */
async function chamarUserConsultantInfo(
  bancaUrl: string,
  email: string,
  apiKey: string
): Promise<{ success?: boolean; existe?: boolean; total_consultores_abaixo?: number } | null> {
  const base = normalizarUrlBanca(bancaUrl);
  if (!base) return null;
  try {
    const url = `${base}/api/crm/user-consultant-info?email=${encodeURIComponent(email)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'X-API-KEY': apiKey.trim(), Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 404) {
      console.warn('[CRM Bancas] user-consultant-info 404 (endpoint não encontrado):', base);
      console.warn('[CRM Bancas] curl utilizado:', buildCurlExample('GET', url, apiKey));
      return null;
    }
    if (!res.ok) {
      console.warn('[CRM Bancas] user-consultant-info HTTP', res.status, res.statusText, 'para banca:', base);
      return null;
    }
    const body = await res.json();
    return body ?? null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CRM Bancas] Erro ao chamar user-consultant-info para banca:', base, msg);
    return null;
  }
}

/**
 * Para uma banca, chama a API user-consultant-info na URL da banca.
 * Retorna true se success, existe e total_consultores_abaixo > 0 (uso para gerente).
 */
async function bancaTemConsultoresAbaixoDoGerente(
  bancaUrl: string,
  email: string,
  apiKey: string
): Promise<boolean> {
  const body = await chamarUserConsultantInfo(bancaUrl, email, apiKey);
  return !!(body?.success && body?.existe && (body?.total_consultores_abaixo ?? 0) > 0);
}

/**
 * Verifica se o consultor tem lead na banca via get-indicateds-by-consultant.
 * Requisito do filtro de bancas: per_page=1 e SEM from/to (sem data), para considerar qualquer lead em qualquer período.
 * transferredFilter: quando 'yes' ou 'no', adiciona transferred_filter na URL (ex.: kanban usa 'no', transferido usa 'yes').
 * Retorna true se a API retorna success === true e há pelo menos 1 lead (data.length > 0).
 */
async function bancaTemLeadDoConsultor(
  bancaUrl: string,
  email: string,
  apiKey: string,
  transferredFilter?: 'yes' | 'no'
): Promise<boolean> {
  const base = normalizarUrlBanca(bancaUrl);
  if (!base) return false;
  try {
    const params = new URLSearchParams({
      consultant: email,
      per_page: '1',
    });
    if (transferredFilter) params.set('transferred_filter', transferredFilter);
    const url = `${base}/api/crm/get-indicateds-by-consultant?${params.toString()}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'X-API-KEY': apiKey.trim(), Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 404) {
      console.warn('[CRM Bancas] get-indicateds-by-consultant 404 (endpoint não encontrado):', base);
      console.warn('[CRM Bancas] curl utilizado:', buildCurlExample('GET', url, apiKey));
      return false;
    }
    if (!res.ok) {
      console.warn('[CRM Bancas] get-indicateds-by-consultant HTTP', res.status, res.statusText, 'para banca:', base);
      return false;
    }
    const body = await res.json();
    const hasLead = body?.success === true && Array.isArray(body?.data) && body.data.length > 0;
    return hasLead;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CRM Bancas] Erro ao chamar get-indicateds-by-consultant para banca:', base, msg);
    return false;
  }
}

/**
 * Para gerentes: busca todas as bancas em crm_bancas e, para cada banca, chama
 * user-consultant-info na URL da banca. Retorna apenas bancas onde total_consultores_abaixo > 0.
 * Se CRM_API_KEY não estiver definida ou nenhuma banca tiver consultores abaixo, retorna [] (fallback é feito no GET).
 */
async function filtrarBancasParaGerente(
  bancas: BancaRow[],
  email: string
): Promise<BancaRow[]> {
  const apiKey = process.env.CRM_API_KEY?.trim();
  if (!apiKey) {
    console.warn('[CRM Bancas] CRM_API_KEY não definida; usando fallback (bancas do usuário ou todas).');
    return [];
  }
  const resultados = await mapWithConcurrency(
    bancas,
    EXTERNAL_API_CONCURRENCY,
    async (banca) => ((await bancaTemConsultoresAbaixoDoGerente(banca.url, email, apiKey)) ? banca : null)
  );
  return resultados.filter((b): b is BancaRow => b !== null);
}

/**
 * Para consultor: filtra bancas em que o consultor tem pelo menos um lead.
 * Usa get-indicateds-by-consultant SEM from/to (sem data). transferredFilter opcional (ex.: 'no' para kanban, 'yes' para transferido).
 */
async function filtrarBancasComLeadDoConsultor(
  bancas: BancaRow[],
  email: string,
  transferredFilter?: 'yes' | 'no'
): Promise<BancaRow[]> {
  const apiKey = process.env.CRM_API_KEY?.trim();
  if (!apiKey) {
    console.warn('[CRM Bancas] CRM_API_KEY não definida; fallback: bancas do usuário ou todas.');
    return [];
  }
  if (bancas.length > 0) {
    const base = normalizarUrlBanca(bancas[0].url);
    if (base) {
      const params = new URLSearchParams({ consultant: email, per_page: '1' });
      if (transferredFilter) params.set('transferred_filter', transferredFilter);
      const url = `${base}/api/crm/get-indicateds-by-consultant?${params.toString()}`;
      console.log('[CRM Bancas] Modelo de curl utilizado em todas as bancas para filtrar:');
      console.log('[CRM Bancas] ', buildCurlExample('GET', url, apiKey));
    }
  }
  const resultados = await mapWithConcurrency(
    bancas,
    EXTERNAL_API_CONCURRENCY,
    async (banca) => ((await bancaTemLeadDoConsultor(banca.url, email, apiKey, transferredFilter)) ? banca : null)
  );
  const bancasQuePassaram = resultados.filter((b): b is BancaRow => b !== null);
  console.log('[CRM Bancas] Bancas que passaram pelo filtro:', bancasQuePassaram.length);
  bancasQuePassaram.forEach((b, i) => {
    console.log(`[CRM Bancas]   ${i + 1}. ${(b.name ?? b.id) || b.id} (id: ${b.id}) | ${b.url}`);
  });
  return bancasQuePassaram;
}

/**
 * Retorna as bancas em que o usuário está atribuído (user_bancas -> crm_bancas).
 */
async function getBancasDoUsuario(userId: string): Promise<BancaRow[]> {
  const { data: row, error } = await supabaseServiceRole
    .from('user_bancas')
    .select('banca_ids')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !Array.isArray(row?.banca_ids) || row.banca_ids.length === 0) return [];

  const bancaIds = row.banca_ids as string[];
  const { data: bancas, error: bancasError } = await supabaseServiceRole
    .from('crm_bancas')
    .select('id, name, url')
    .in('id', bancaIds)
    .order('name', { ascending: true });

  if (bancasError || !bancas?.length) return [];
  return bancas as BancaRow[];
}

/** Opções para getBancasVisiveis (ex.: contexto kanban vs transferido). */
export type GetBancasVisiveisOptions = {
  transferredFilter?: 'yes' | 'no';
  /** Quando true (ex.: botão "Carregar bancas" no perfil), força busca em todas as bancas por API em vez de usar user_bancas. */
  forceSearchAllBancas?: boolean;
};

/**
 * Retorna a lista de bancas visíveis para o usuário (mesma lógica do GET).
 * Gerente: usa apenas user_bancas (sem API externa).
 * Consultor: se tiver bancas em user_bancas, usa essas (evita filtro por API ao carregar kanban/transferidos);
 *            senão chama API externa (get-indicateds-by-consultant) por banca.
 * transferredFilter: quando 'yes' ou 'no', inclui na URL (kanban = 'no', transferido = 'yes').
 */
export async function getBancasVisiveis(
  userId: string,
  profile: UserProfile | null,
  options?: GetBancasVisiveisOptions
): Promise<BancaRow[]> {
  const transferredFilter = options?.transferredFilter;
  const forceSearchAllBancas = options?.forceSearchAllBancas === true;
  console.log('[CRM Bancas] getBancasVisiveis chamado | userId:', userId, '| perfil:', profile?.status ?? 'null', '| email:', profile?.email ? `${profile.email.slice(0, 3)}***` : 'n/a', '| transferred_filter:', transferredFilter ?? 'não informado', '| forceSearchAllBancas:', forceSearchAllBancas);
  const { data: todasBancas, error } = await supabaseServiceRole
    .from('crm_bancas')
    .select('id, name, url')
    .order('name', { ascending: true });

  if (error || !todasBancas?.length) {
    console.log('[CRM Bancas] Nenhuma banca em crm_bancas ou erro:', error?.message ?? 'sem dados');
    return [];
  }
  const bancas = excluirBancaPorNome(todasBancas as BancaRow[], NOME_BANCA_EXCLUIDA_BUSCA);

  // Gerente: sem "Carregar bancas" usa user_bancas; com "Carregar bancas" (forceSearchAllBancas) usa o mesmo filtro por API que o consultor.
  if (profile?.status === 'gerente' && !forceSearchAllBancas) {
    const bancasDoUsuario = await getBancasDoUsuario(userId);
    if (bancasDoUsuario.length > 0) {
      console.log('[CRM Bancas] Gerente: usando user_bancas (', bancasDoUsuario.length, ' bancas)');
      return bancasDoUsuario;
    }
    console.log('[CRM Bancas] Gerente: user_bancas vazio; fallback para todas as bancas (total:', bancas.length, ')');
    return bancas;
  }

  // Consultor (sem forceSearchAllBancas): prioriza user_bancas para não fazer filtro por API ao carregar kanban/transferidos.
  if (profile?.status === 'consultor' && !forceSearchAllBancas) {
    const bancasDoUsuario = await getBancasDoUsuario(userId);
    if (bancasDoUsuario.length > 0) {
      console.log('[CRM Bancas] Consultor: usando user_bancas (', bancasDoUsuario.length, ' bancas) — sem filtro por API');
      return bancasDoUsuario;
    }
  }

  const apiKey = process.env.CRM_API_KEY?.trim() ?? '';
  const email = profile?.email?.trim();

  // Consultor ou Gerente (página /perfil — botão "Carregar bancas"): filtro por API externa em TODAS as bancas.
  // total-indicateds-by-consultant?consultant=email — 200 = cadastrado (apto); 404 = não cadastrado (não apto).
  // O curl de cada requisição é exibido no terminal.
  if ((profile?.status === 'consultor' || profile?.status === 'gerente') && email && apiKey) {
    const ctxPerfil = forceSearchAllBancas ? ' [página /perfil — botão Carregar bancas]' : '';
    console.log('[CRM Bancas] Busca em TODAS as bancas (filtro total-indicateds-by-consultant)' + ctxPerfil + ' | perfil:', profile?.status, '| total:', bancas.length, '| email:', email.slice(0, 3) + '***');
    const bancasVisiveis: BancaRow[] = [];
    for (let i = 0; i < bancas.length; i++) {
      const b = bancas[i];
      const base = normalizarUrlBanca(b.url);
      if (!base) {
        console.log(`[CRM Bancas]   ${i + 1}. ${(b.name ?? b.id) || b.id} — URL inválida, ignorada`);
        continue;
      }
      const params = new URLSearchParams({ consultant: email });
      const urlExterna = `${base}/api/crm/total-indicateds-by-consultant?${params.toString()}`;
      console.log('[CRM Bancas]' + (forceSearchAllBancas ? ' /perfil Carregar bancas —' : '') + ' curl da requisição:', buildCurlExample('GET', urlExterna, apiKey));
      const { status, body } = await fetchGetIndicatedsResponse(urlExterna, apiKey);
      if (status === 200) {
        bancasVisiveis.push(b);
        console.log(`[CRM Bancas]   ${i + 1}/${bancas.length}. ${(b.name ?? b.id) || b.id} (id: ${b.id}) | ${b.url} — ✅ 200 cadastrado (registrar em user_bancas)`);
      } else if (status === 404) {
        console.log(`[CRM Bancas]   ${i + 1}/${bancas.length}. ${(b.name ?? b.id) || b.id} (id: ${b.id}) | ${b.url} — ❌ 404 não cadastrado`);
        if (forceSearchAllBancas) {
          console.log('[CRM Bancas]     Curl:', buildCurlExample('GET', urlExterna, apiKey));
          console.log('[CRM Bancas]     Body:', body);
        }
      } else if (status === 500) {
        const bancaNome = (b.name ?? b.id) || b.url;
        console.error('[CRM Bancas]   Banca retornou 500:', bancaNome, '| url:', urlExterna, '| body:', body);
        throw new Error(`A banca "${bancaNome}" retornou erro 500 ao verificar indicados. Tente novamente mais tarde.`);
      } else {
        console.log(`[CRM Bancas]   ${i + 1}/${bancas.length}. ${(b.name ?? b.id) || b.id} (id: ${b.id}) | ${b.url} — status ${status}`);
        console.log('[CRM Bancas]     Curl:', buildCurlExample('GET', urlExterna, apiKey));
        console.log('[CRM Bancas]     Body:', body);
      }
    }
    console.log('[CRM Bancas] Busca concluída. Bancas aptas (200) para user_bancas:', bancasVisiveis.length, 'de', bancas.length);
    if (bancasVisiveis.length > 0) return bancasVisiveis;
    const fallback = await getBancasDoUsuario(userId);
    return fallback.length > 0 ? fallback : bancas;
  }

  if (profile?.status === 'consultor' || profile?.status === 'gerente') {
    if (forceSearchAllBancas && (!apiKey || !email)) {
      console.log('[CRM Bancas] Carregar bancas (' + profile?.status + '): CRM_API_KEY ou email ausente — curl não será exibido. Fallback: user_bancas ou todas.');
    }
    const fallback = await getBancasDoUsuario(userId);
    return fallback.length > 0 ? fallback : bancas;
  }

  return bancas;
}

/**
 * GET /api/crm/bancas - Lista bancas para filtro do CRM e modal "Bancas em que atuo" no perfil.
 * - Gerente: usa apenas user_bancas (sem chamadas às APIs das bancas). Fallback: todas as bancas.
 * - Consultor: chama API externa (get-indicateds-by-consultant) em cada banca; fallback: user_bancas ou todas.
 * - super_admin / admin: retorna todas as bancas de crm_bancas (ou, se targetUserId for informado, as bancas do usuário alvo).
 * - Query opcional: targetUserId — quando o requester é super_admin/admin, retorna as bancas do usuário alvo (para CRM "visualizando como").
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const targetUserIdParam = req.nextUrl.searchParams.get('targetUserId')?.trim() || null;

    let effectiveUserId = userId;
    let profile = await getUserProfile(userId);

    if (targetUserIdParam && targetUserIdParam !== userId) {
      const allowed = await canAccessUser(userId, targetUserIdParam);
      if (!allowed) {
        return errorResponse('Sem permissão para acessar as bancas deste usuário.', 403);
      }
      const targetProfile = await getUserProfile(targetUserIdParam);
      if (!targetProfile) {
        return errorResponse('Usuário alvo não encontrado.', 404);
      }
      effectiveUserId = targetUserIdParam;
      profile = targetProfile;
      console.log('[CRM Bancas] GET /api/crm/bancas | modo "visualizar como" | targetUserId:', targetUserIdParam);
    }

    const transferredFilterParam = req.nextUrl.searchParams.get('transferred_filter')?.trim().toLowerCase();
    const transferredFilter = (transferredFilterParam === 'yes' || transferredFilterParam === 'no') ? transferredFilterParam : undefined;
    const cacheKey = `bancas:${effectiveUserId}:${profile?.status ?? ''}:${profile?.email ?? ''}:${transferredFilter ?? 'any'}`;
    const cached = getCachedBancas(cacheKey);
    if (cached !== null) {
      console.log('[CRM Bancas] GET /api/crm/bancas solicitado | Cache HIT');
      console.log('[CRM Bancas] Bancas que passaram pelo filtro (última consulta):', cached.length);
      cached.forEach((b: BancaRow, i: number) => {
        console.log(`[CRM Bancas]   ${i + 1}. ${(b.name ?? b.id) || b.id} (id: ${b.id}) | ${b.url} — passou no filtro`);
      });
      const res = successResponse(cached);
      res.headers.set('Cache-Control', 'private, max-age=60');
      res.headers.set('X-Cache', 'HIT');
      return res;
    }

    let promise = bancasInFlight.get(cacheKey);
    if (!promise) {
      promise = getBancasVisiveis(effectiveUserId, profile, { transferredFilter }).finally(() => {
        bancasInFlight.delete(cacheKey);
      });
      bancasInFlight.set(cacheKey, promise);
    }

    console.log('[CRM Bancas] GET /api/crm/bancas solicitado | Cache MISS — recalculando bancas visíveis');
    const ignoreFilter = req.nextUrl.searchParams.get('ignoreFilter') === 'true';
    const bancas = ignoreFilter
      ? await (async () => {
        const { data } = await supabaseServiceRole.from('crm_bancas').select('id, name, url').order('name', { ascending: true });
        return excluirBancaPorNome((data || []) as BancaRow[], NOME_BANCA_EXCLUIDA_BUSCA);
      })()
      : await promise;

    if (!ignoreFilter) {
      setCachedBancas(cacheKey, bancas);
    }

    const res = successResponse(bancas);
    res.headers.set('Cache-Control', 'private, max-age=60');
    res.headers.set('X-Cache', 'MISS');
    return res;
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

