import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { checkInstanceAccess } from '@/lib/utils/instance-access';
import {
  fetchGroupsFromEvolution,
  persistWhatsappGroupsBatch,
} from '@/lib/group-fetch/run-group-fetch-job';

/** Vercel / ambientes com função longa; no Netlify o limite real costuma ser ~26s na rota Next. */
export const maxDuration = 300;

const SYNC_FETCH_TIMEOUT_MS = 280_000;

/**
 * Modo assíncrono na Netlify com GROUP_FETCH_JOB_SECRET (Background Function + polling no cliente).
 *
 * Importante: `NETLIFY=true` existe no *build* da Netlify, mas não nas variáveis read-only do
 * *runtime* das Functions (Next API routes). Lá a Netlify expõe SITE_ID, SITE_NAME e URL.
 * Sem SITE_ID a rota caía no modo síncrono e estourava o limite (~26s) → 504.
 *
 * Em `next dev` puro permanece síncrono para não criar jobs órfãos (sem worker local).
 */
function useNetlifyAsyncGroupFetch(): boolean {
  const secret = !!process.env.GROUP_FETCH_JOB_SECRET?.trim();
  if (!secret) return false;

  const onNetlifyRuntime =
    process.env.NETLIFY === 'true' ||
    process.env.NETLIFY_DEV === 'true' ||
    !!process.env.SITE_ID?.trim() ||
    !!process.env.NETLIFY_SITE_ID?.trim();

  const plainNextDev =
    process.env.NODE_ENV === 'development' && process.env.NETLIFY_DEV !== 'true';

  if (plainNextDev) return false;

  return onNetlifyRuntime;
}

function resolveNetlifySiteUrl(requestOrigin: string): string {
  const envUrl = (process.env.URL || process.env.SITE_URL || '').replace(/\/$/, '');
  if (envUrl) return envUrl;
  return requestOrigin.replace(/\/$/, '');
}

function resolveGroupsFetchBackgroundUrl(origin: string): string {
  const fnBase = (
    process.env.NETLIFY_FUNCTIONS_URL ||
    process.env.NEXT_PUBLIC_NETLIFY_FUNCTIONS_URL ||
    ''
  )
    .trim()
    .replace(/\/$/, '');
  if (fnBase.startsWith('http://') || fnBase.startsWith('https://')) {
    return `${fnBase}/groups-fetch-background`;
  }
  const siteUrl = resolveNetlifySiteUrl(origin);
  return `${siteUrl}/.netlify/functions/groups-fetch-background`;
}

async function triggerBackgroundWorker(origin: string, jobId: string): Promise<{ ok: boolean; status?: number }> {
  const secret = process.env.GROUP_FETCH_JOB_SECRET?.trim();
  if (!secret) return { ok: false };

  const url = resolveGroupsFetchBackgroundUrl(origin);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12_000);

  try {
    console.log(`[GROUPS] Triggering background worker: ${url} jobId=${jobId}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-group-fetch-secret': secret,
      },
      body: JSON.stringify({ jobId }),
      signal: controller.signal,
    });
    clearTimeout(t);
    const ok = res.ok || res.status === 202;
    if (!ok) {
      console.warn(`[GROUPS] Background trigger failed: HTTP ${res.status}`);
    }
    return { ok, status: res.status };
  } catch (err) {
    clearTimeout(t);
    console.warn(`[GROUPS] Background trigger error:`, err instanceof Error ? err.message : err);
    return { ok: false };
  }
}

/**
 * GET /api/groups/fetch?jobId=...
 * Status de um job assíncrono (Netlify).
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const jobId = req.nextUrl.searchParams.get('jobId')?.trim();
    if (!jobId) {
      return errorResponse('jobId é obrigatório', 400);
    }

    const { data: job, error } = await supabaseServiceRole
      .from('group_fetch_jobs')
      .select(
        'id, status, error_message, total_groups, inserted_count, updated_count, message, created_at, updated_at',
      )
      .eq('id', jobId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      return errorResponse(`Erro ao buscar job: ${error.message}`, 500);
    }
    if (!job) {
      return errorResponse('Job não encontrado', 404);
    }

    return successResponse(job, 'Status do job');
  } catch (err: unknown) {
    return serverErrorResponse(err);
  }
}

/**
 * POST /api/groups/fetch
 * - Netlify (SITE_ID no runtime ou netlify dev) + GROUP_FETCH_JOB_SECRET: job assíncrono + Background Function.
 * - Demais ambientes: request síncrono com persistência em lote.
 * Body opcional: { forceSync: true } força modo síncrono (útil em dev).
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json().catch(() => ({}));
    const { instanceName, forceSync } = body as { instanceName?: string; forceSync?: boolean };

    if (!instanceName) {
      return errorResponse('instanceName é obrigatório', 400);
    }

    const hasAccess = await checkInstanceAccess(userId, instanceName);
    if (!hasAccess) {
      return errorResponse('Acesso negado. Você não tem permissão para acessar esta instância.', 403);
    }

    const asyncMode = useNetlifyAsyncGroupFetch() && !forceSync;

    if (asyncMode) {
      const { data: inserted, error: insErr } = await supabaseServiceRole
        .from('group_fetch_jobs')
        .insert({
          user_id: userId,
          instance_name: instanceName,
          status: 'pending',
        })
        .select('id')
        .single();

      if (insErr || !inserted?.id) {
        console.error('[GROUPS] Erro ao criar job:', insErr);
        return errorResponse('Não foi possível iniciar a busca em segundo plano.', 500);
      }

      const jobId = inserted.id as string;
      const requestOrigin = req.nextUrl.origin || req.headers.get('origin') || '';
      const trigger = await triggerBackgroundWorker(requestOrigin, jobId);

      return successResponse(
        {
          jobId,
          async: true,
          workerTriggered: trigger.ok,
          message: trigger.ok
            ? 'Busca iniciada. Use GET /api/groups/fetch?jobId=... até status completed.'
            : 'Job criado; o processamento será retomado em até ~1 min (cron de fallback).',
        },
        trigger.ok ? 'Busca de grupos iniciada em segundo plano.' : 'Busca agendada (worker será reinvocado).',
      );
    }

    // --- Modo síncrono ---
    const { data: instance, error: instanceError } = await supabaseServiceRole
      .from('evolution_instances')
      .select(
        `
        *,
        evolution_apis!inner (
          id,
          base_url,
          is_active
        )
      `,
      )
      .eq('instance_name', instanceName)
      .eq('is_active', true)
      .eq('evolution_apis.is_active', true)
      .single();

    if (instanceError || !instance) {
      console.error(`[GROUPS] Instância não encontrada: ${instanceName}`, instanceError);
      return errorResponse('Instância não encontrada', 404);
    }

    const instanceApikey = instance.apikey;
    if (!instanceApikey) {
      console.error(`[GROUPS] Instância ${instanceName} não possui apikey`);
      return errorResponse('Instância sem apikey configurada', 404);
    }

    const evolutionApi = Array.isArray(instance.evolution_apis) ? instance.evolution_apis[0] : instance.evolution_apis;

    if (!evolutionApi?.base_url) {
      return errorResponse('Evolution API sem base_url configurada', 404);
    }

    const baseUrl = evolutionApi.base_url.trim().replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
    console.log(`[GROUPS] Buscando grupos (sync) instance=${instanceName}`);

    let uniqueGroups;
    try {
      uniqueGroups = await fetchGroupsFromEvolution(
        instanceName,
        instanceApikey,
        baseUrl,
        SYNC_FETCH_TIMEOUT_MS,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Timeout ao buscar grupos')) {
        return errorResponse('Timeout ao buscar grupos. A instância pode ter muitos grupos — tente novamente.', 408);
      }
      const isNetwork = msg === 'fetch failed' || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND');
      const isConnClosed = msg.toLowerCase().includes('connection closed');
      if (isConnClosed) {
        return errorResponse('A instância caiu (Connection Closed). Verifique o status da instância.', 503);
      }
      if (msg.startsWith('Evolution fetchAllGroups:')) {
        return errorResponse(msg.replace(/^Evolution fetchAllGroups:\s*/, 'Erro da API: '), 502);
      }
      if (msg.includes('não é JSON')) {
        return errorResponse('Resposta da API não é JSON válido', 502);
      }
      return errorResponse(
        isNetwork ? 'Evolution API inacessível. Verifique a URL e a conectividade.' : msg || 'Erro ao buscar grupos',
        503,
      );
    }

    const { inserted, updated } = await persistWhatsappGroupsBatch(
      supabaseServiceRole,
      userId,
      instanceName,
      uniqueGroups,
    );

    console.log(`[GROUPS] ${uniqueGroups.length} grupo(s), ${inserted} inseridos, ${updated} atualizados`);

    return successResponse(
      uniqueGroups,
      `${uniqueGroups.length} grupo(s) encontrado(s). ${inserted} inseridos, ${updated} atualizados.`,
    );
  } catch (err: unknown) {
    return serverErrorResponse(err);
  }
}
