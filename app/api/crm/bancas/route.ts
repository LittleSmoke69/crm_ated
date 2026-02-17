import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile, UserProfile } from '@/lib/middleware/permissions';
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
 * Chamada feita SEM from/to (sem data determinada), para considerar qualquer lead em qualquer período.
 * Retorna true se a API retorna success === true e há pelo menos 1 lead (data.length > 0).
 */
async function bancaTemLeadDoConsultor(
  bancaUrl: string,
  email: string,
  apiKey: string
): Promise<boolean> {
  const base = normalizarUrlBanca(bancaUrl);
  if (!base) return false;
  try {
    const url = `${base}/api/crm/get-indicateds-by-consultant?consultant=${encodeURIComponent(email)}&per_page=1`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'X-API-KEY': apiKey.trim(), Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 404) {
      console.warn('[CRM Bancas] get-indicateds-by-consultant 404 (endpoint não encontrado):', base);
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
 * Usa get-indicateds-by-consultant SEM from/to (sem data), para incluir qualquer banca com lead.
 */
async function filtrarBancasComLeadDoConsultor(
  bancas: BancaRow[],
  email: string
): Promise<BancaRow[]> {
  const apiKey = process.env.CRM_API_KEY?.trim();
  if (!apiKey) {
    console.warn('[CRM Bancas] CRM_API_KEY não definida; fallback: bancas do usuário ou todas.');
    return [];
  }
  const resultados = await mapWithConcurrency(
    bancas,
    EXTERNAL_API_CONCURRENCY,
    async (banca) => ((await bancaTemLeadDoConsultor(banca.url, email, apiKey)) ? banca : null)
  );
  return resultados.filter((b): b is BancaRow => b !== null);
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

/**
 * Retorna a lista de bancas visíveis para o usuário (mesma lógica do GET).
 * Usado pelo GET /api/crm/bancas e por GET /api/crm/leads quando banca_url=all.
 */
export async function getBancasVisiveis(userId: string, profile: UserProfile | null): Promise<BancaRow[]> {
  const { data: todasBancas, error } = await supabaseServiceRole
    .from('crm_bancas')
    .select('id, name, url')
    .order('name', { ascending: true });

  if (error || !todasBancas?.length) return [];
  const bancas = excluirBancaPorNome(todasBancas as BancaRow[], NOME_BANCA_EXCLUIDA_BUSCA);

  if (profile?.status === 'consultor') {
    const email = profile.email?.trim();
    if (!email) {
      const fallback = await getBancasDoUsuario(userId);
      return fallback.length > 0 ? fallback : bancas;
    }
    // Busca em TODAS as bancas, com chamada SEM from/to, para incluir no dropdown as que tiverem lead
    const bancasComLead = await filtrarBancasComLeadDoConsultor(bancas, email);
    if (bancasComLead.length > 0) {
      return bancasComLead;
    }
    const fallback = await getBancasDoUsuario(userId);
    return fallback.length > 0 ? fallback : bancas;
  }

  if (profile?.status === 'gerente') {
    const email = profile.email?.trim();
    if (!email) {
      const fallback = await getBancasDoUsuario(userId);
      return fallback.length > 0 ? fallback : bancas;
    }
    const bancasVisiveis = await filtrarBancasParaGerente(bancas, email);
    if (bancasVisiveis.length === 0) {
      const fallback = await getBancasDoUsuario(userId);
      return fallback.length > 0 ? fallback : bancas;
    }
    return bancasVisiveis;
  }

  return bancas;
}

/**
 * GET /api/crm/bancas - Lista bancas para filtro do CRM e modal "Bancas em que atuo" no perfil.
 * - Consultor: chama get-indicateds-by-consultant em TODAS as bancas SEM from/to (sem data), para trazer
 *   bancas onde o consultor tem pelo menos um lead; essas entram no dropdown. Fallback: user_bancas ou todas.
 * - Gerente: tenta filtrar por API externa (user-consultant-info); se CRM_API_KEY ausente ou resultado vazio,
 *   faz fallback: bancas do usuário (user_bancas) e, se ainda vazio, todas as crm_bancas.
 * - super_admin / admin: retorna todas as bancas de crm_bancas.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const profile = await getUserProfile(userId);

    const cacheKey = `bancas:${userId}:${profile?.status ?? ''}:${profile?.email ?? ''}`;
    const cached = getCachedBancas(cacheKey);
    if (cached !== null) {
      const res = successResponse(cached);
      res.headers.set('Cache-Control', 'private, max-age=60');
      res.headers.set('X-Cache', 'HIT');
      return res;
    }

    const bancas = await getBancasVisiveis(userId, profile);
    setCachedBancas(cacheKey, bancas);

    const res = successResponse(bancas);
    res.headers.set('Cache-Control', 'private, max-age=60');
    res.headers.set('X-Cache', 'MISS');
    return res;
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

