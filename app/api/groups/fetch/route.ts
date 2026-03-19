import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { checkInstanceAccess } from '@/lib/utils/instance-access';

// Modo síncrono: limite curto; modo background usa job com tempo longo no process
export const maxDuration = 25;

/**
 * POST /api/groups/fetch - Busca grupos da Evolution API
 * - background=true: cria job e processa em segundo plano (tempo ilimitado), retorna 202 + job_id. Sem verificação de acesso extra (request direto).
 * - background=false ou omitido: busca síncrona com timeout 22s e verificação de acesso.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json().catch(() => ({}));
    const { instanceName, background } = body;

    if (!instanceName) {
      return errorResponse('instanceName é obrigatório', 400);
    }

    // Modo background: cria job e dispara processamento em segundo plano (sem timeout curto; Netlify não corta)
    if (background === true) {
      const { data: instance, error: instanceError } = await supabaseServiceRole
        .from('evolution_instances')
        .select('id')
        .eq('instance_name', instanceName)
        .eq('is_active', true)
        .single();

      if (instanceError || !instance) {
        return errorResponse('Instância não encontrada ou inativa', 404);
      }

      const { data: existingJob } = await supabaseServiceRole
        .from('group_fetch_jobs')
        .select('id')
        .eq('user_id', userId)
        .eq('instance_name', instanceName)
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      let job = existingJob;
      let reused = false;

      if (job?.id) {
        reused = true;
        console.log(`[GROUPS] Reutilizando job existente ${job.id} (${instanceName})`);
      } else {
        const { data: inserted, error: jobError } = await supabaseServiceRole
          .from('group_fetch_jobs')
          .insert({
            user_id: userId,
            instance_name: instanceName,
            status: 'pending',
          })
          .select('id')
          .single();

        if (jobError || !inserted) {
          console.error('[GROUPS] Erro ao criar job de busca:', jobError);
          return errorResponse('Erro ao criar job de busca. Tente novamente.', 500);
        }
        job = inserted;
      }

      const cronSecret = process.env.CRON_SECRET;
      if (cronSecret) {
        const base =
          process.env.URL ||
          process.env.NEXT_PUBLIC_SITE_URL ||
          (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
        const siteUrl = base ? base.replace(/\/$/, '') : null;
        if (siteUrl) {
          fetch(`${siteUrl}/api/groups/fetch/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-cron-secret': cronSecret },
          }).catch((err) => console.warn('[GROUPS] Trigger do process em background falhou:', err?.message));
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          job_id: job!.id,
          background: true,
          reused,
          message: reused
            ? 'Já existe uma busca em andamento para esta instância. Aguarde o retorno.'
            : 'Busca de grupos em segundo plano. Aguarde o retorno.',
        }),
        { status: 202, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Modo síncrono: verifica acesso e busca com timeout curto
    const hasAccess = await checkInstanceAccess(userId, instanceName);
    if (!hasAccess) {
      return errorResponse('Acesso negado. Você não tem permissão para acessar esta instância.', 403);
    }

    // Busca a instância e sua Evolution API
    const { data: instance, error: instanceError } = await supabaseServiceRole
      .from('evolution_instances')
      .select(`
        *,
        evolution_apis!inner (
          id,
          base_url,
          is_active
        )
      `)
      .eq('instance_name', instanceName)
      .eq('is_active', true)
      .eq('evolution_apis.is_active', true)
      .single();

    if (instanceError || !instance) {
      console.error(`❌ [GROUPS] Instância não encontrada: ${instanceName}`, instanceError);
      return errorResponse('Instância não encontrada', 404);
    }

    // CRÍTICO: Usa a apikey da instância (não a global)
    const instanceApikey = instance.apikey;
    
    if (!instanceApikey) {
      console.error(`❌ [GROUPS] Instância ${instanceName} não possui apikey`);
      return errorResponse('Instância sem apikey configurada', 404);
    }

    const evolutionApi = Array.isArray(instance.evolution_apis) 
      ? instance.evolution_apis[0] 
      : instance.evolution_apis;

    if (!evolutionApi?.base_url) {
      return errorResponse('Evolution API sem base_url configurada', 404);
    }
    
    console.log(`📋 [GROUPS] Buscando grupos da instância ${instanceName} usando apikey da instância`);

    // Um único request aguardando o retorno completo.
    // Instâncias com muitos grupos demoram mais — maxDuration=25 garante tempo suficiente.
    const FETCH_TIMEOUT = 22_000; // 22s (dentro do maxDuration=25)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const url = `${evolutionApi.base_url}/group/fetchAllGroups/${instanceName}?getParticipants=false`;
    console.log(`🔄 [GROUPS] Buscando grupos: ${url}`);

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'GET',
        headers: { apikey: instanceApikey },
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timeoutId);
    } catch (err: any) {
      clearTimeout(timeoutId);
      const msg = err?.message ?? '';
      if (err.name === 'AbortError') {
        console.error(`⏱️ [GROUPS] Timeout após ${FETCH_TIMEOUT}ms`);
        return errorResponse('Timeout ao buscar grupos. A instância pode ter muitos grupos — tente novamente.', 408);
      }
      const isNetwork = msg === 'fetch failed' || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND');
      console.error(`❌ [GROUPS] Erro na requisição:`, msg);
      return errorResponse(
        isNetwork ? 'Evolution API inacessível. Verifique a URL e a conectividade.' : (msg || 'Erro ao buscar grupos'),
        503
      );
    }

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => '');
      console.error(`❌ [GROUPS] Resposta não OK (${resp.status}): ${errorText.substring(0, 200)}`);

      let responseData: any = {};
      try { responseData = JSON.parse(errorText); } catch {}

      const errorMsg = responseData?.response?.message || responseData?.message || responseData?.error || errorText || '';
      const isConnectionClosed =
        (typeof errorMsg === 'string' && errorMsg.toLowerCase().includes('connection closed')) ||
        (typeof errorText === 'string' && errorText.toLowerCase().includes('connection closed'));

      if (isConnectionClosed) {
        return errorResponse('A instância caiu (Connection Closed). Verifique o status da instância.', 503);
      }
      return errorResponse(`Erro da API: ${resp.status}`, resp.status);
    }

    const contentType = resp.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await resp.text();
      console.error(`❌ [GROUPS] Resposta não é JSON. Content-Type: ${contentType}, Preview: ${text.substring(0, 200)}`);
      return errorResponse('Resposta da API não é JSON válido', 502);
    }

    const json = await resp.json().catch((parseError) => {
      console.error(`❌ [GROUPS] Erro ao parsear JSON:`, parseError);
      throw parseError;
    });

    const jsonKeys = typeof json === 'object' && json !== null ? Object.keys(json) : [];
    console.log(`📥 [GROUPS] Resposta - tipo: ${Array.isArray(json) ? 'array' : typeof json}, keys: ${jsonKeys.join(', ') || '(nenhuma)'}, length: ${Array.isArray(json) ? json.length : 'N/A'}`);

    let groupsList: any[] = [];
    if (Array.isArray(json)) groupsList = json;
    else if (Array.isArray(json?.groups)) groupsList = json.groups;
    else if (Array.isArray(json?.data)) groupsList = json.data;
    else if (Array.isArray(json?.result)) groupsList = json.result;
    else if (json?.id && json?.subject) groupsList = [json];

    if (groupsList.length > 0) {
      console.log(`✅ [GROUPS] ${groupsList.length} grupo(s) encontrado(s)`);
      return successResponse(groupsList, `${groupsList.length} grupo(s) encontrado(s)`);
    }

    const sample = JSON.stringify(json).substring(0, 800);
    console.warn(`⚠️ [GROUPS] Nenhum grupo mapeado. Amostra:`, sample);
    return successResponse([], 'Nenhum grupo encontrado na instância.');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

