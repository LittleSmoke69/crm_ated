import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { evolutionService } from '@/lib/services/evolution-service';
import { checkInstanceAccess } from '@/lib/utils/instance-access';

/**
 * POST /api/groups/fetch - Busca grupos da Evolution API
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { instanceName } = body;

    if (!instanceName) {
      return errorResponse('instanceName é obrigatório', 400);
    }

    // Verifica se o usuário tem acesso à instância
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

    // Timeout reduzido para evitar 504 do servidor (Vercel/Netlify tem limite de ~60s)
    // Usamos timeout menor e retry mais rápido
    const PER_TRY_TIMEOUT = 50_000; // 50 segundos (reduzido de 5 minutos)
    const MAX_TOTAL_MS = 45_000; // 45 segundos total (reduzido de 10 minutos)
    const started = Date.now();
    let attempt = 0;
    let lastError: any = null;

    while (Date.now() - started < MAX_TOTAL_MS) {
      attempt += 1;
      try {
        const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs: number) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => {
            controller.abort();
            console.warn(`⏱️ [GROUPS] Timeout de ${timeoutMs}ms atingido na tentativa ${attempt}`);
          }, timeoutMs);
          
          try {
            const response = await fetch(url, { 
              ...options, 
              signal: controller.signal, 
              cache: 'no-store' 
            });
            clearTimeout(timeoutId);
            return response;
          } catch (fetchError: any) {
            clearTimeout(timeoutId);
            // Se foi abortado por timeout, relança com mensagem específica
            if (fetchError.name === 'AbortError' || controller.signal.aborted) {
              throw new Error(`Timeout: requisição excedeu ${timeoutMs}ms`);
            }
            throw fetchError;
          }
        };

        const url = `${evolutionApi.base_url}/group/fetchAllGroups/${instanceName}?getParticipants=true`;
        console.log(`🔄 [GROUPS] Tentativa ${attempt}: Buscando grupos em ${url}`);
        
        const resp = await fetchWithTimeout(
          url,
          { method: 'GET', headers: { apikey: instanceApikey } }, // CRÍTICO: Usa apikey da instância
          PER_TRY_TIMEOUT
        );

        if (resp.ok) {
          // Verifica se a resposta é JSON antes de tentar parsear
          const contentType = resp.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            const text = await resp.text();
            console.error(`❌ [GROUPS] Resposta não é JSON. Content-Type: ${contentType}, Preview: ${text.substring(0, 200)}`);
            throw new Error('Resposta da API não é JSON válido');
          }

          const json = await resp.json().catch((parseError) => {
            console.error(`❌ [GROUPS] Erro ao parsear JSON:`, parseError);
            throw parseError;
          });

          // Log do retorno bruto quando em desenvolvimento (estrutura da resposta)
          const jsonKeys = typeof json === 'object' && json !== null ? Object.keys(json) : [];
          console.log(`📥 [GROUPS] Resposta recebida - tipo: ${Array.isArray(json) ? 'array' : typeof json}, keys: ${jsonKeys.join(', ') || '(nenhuma)'}, isArrayLength: ${Array.isArray(json) ? json.length : 'N/A'}`);

          let groupsList: any[] = [];

          if (Array.isArray(json)) {
            groupsList = json;
          } else if (Array.isArray(json?.groups)) {
            groupsList = json.groups;
          } else if (Array.isArray(json?.data)) {
            groupsList = json.data;
          } else if (Array.isArray(json?.result)) {
            groupsList = json.result;
          } else if (json?.id && json?.subject) {
            groupsList = [json];
          }

          if (groupsList.length > 0) {
            console.log(`✅ [GROUPS] ${groupsList.length} grupo(s) encontrado(s) na tentativa ${attempt}`);
            return successResponse(groupsList, `${groupsList.length} grupo(s) encontrado(s)`);
          }

          // Resposta OK mas nenhum grupo: loga o retorno completo (truncado) para debug e retorna lista vazia (não entra em loop)
          const sample = JSON.stringify(json).substring(0, 800);
          console.warn(`⚠️ [GROUPS] Resposta OK mas nenhum grupo mapeado na tentativa ${attempt}. Amostra do retorno:`, sample);
          return successResponse([], 'Nenhum grupo encontrado na instância.');
        } else {
          const errorText = await resp.text().catch(() => '');
          console.error(`❌ [GROUPS] Resposta não OK (${resp.status}): ${errorText.substring(0, 200)}`);
          
          // Verifica se a resposta contém "Connection Closed"
          // Isso indica que a instância caiu e não devemos tentar novamente
          let responseData: any = {};
          try {
            responseData = JSON.parse(errorText);
          } catch {
            // Se não for JSON, verifica no texto bruto
          }
          
          // Verifica "Connection Closed" em diferentes formatos de resposta
          const errorMsg = responseData?.response?.message || 
                          responseData?.message || 
                          responseData?.error || 
                          errorText || '';
          
          const isConnectionClosed = (
            typeof errorMsg === 'string' && 
            errorMsg.toLowerCase().includes('connection closed')
          ) || (
            typeof errorText === 'string' && 
            errorText.toLowerCase().includes('connection closed')
          );
          
          if (isConnectionClosed) {
            console.error(`💥 [GROUPS] Instância ${instanceName} caiu (Connection Closed). Interrompendo tentativas.`);
            return errorResponse('A instância caiu (Connection Closed). Verifique o status da instância.', 503);
          }
          
          lastError = new Error(`API retornou status ${resp.status}`);
        }
      } catch (err: any) {
        lastError = err;
        const msg = err?.message ?? '';
        const isNetworkError = msg === 'fetch failed' || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('network');
        if (err.name === 'AbortError' || msg.includes('Timeout')) {
          console.warn(`⏱️ [GROUPS] Tentativa ${attempt}: timeout após ${PER_TRY_TIMEOUT}ms`);
        } else if (isNetworkError) {
          console.warn(`⚠️ [GROUPS] Tentativa ${attempt}: Evolution API inacessível (verifique URL e conectividade).`);
        } else {
          console.error(`❌ [GROUPS] Tentativa ${attempt} falhou:`, msg || err);
        }
        
        // Se já passou muito tempo, retorna erro imediatamente
        if (Date.now() - started >= MAX_TOTAL_MS) {
          break;
        }
      }

      // Backoff mais curto para não exceder o limite total
      const backoff = Math.min(5000, 2000 * attempt);
      if (Date.now() - started + backoff < MAX_TOTAL_MS) {
        await new Promise(r => setTimeout(r, backoff));
      }
    }

    const rawMsg = lastError?.message || '';
    const isNetworkFailure = rawMsg === 'fetch failed' || rawMsg.includes('ECONNREFUSED') || rawMsg.includes('ENOTFOUND');
    const errorMsg = isNetworkFailure
      ? 'Evolution API inacessível. Verifique a URL da API e a conectividade de rede.'
      : (rawMsg || 'Não foi possível obter os grupos após várias tentativas');
    console.error(`❌ [GROUPS] Falha final após ${attempt} tentativa(s): ${errorMsg}`);
    return errorResponse(errorMsg, 408);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

