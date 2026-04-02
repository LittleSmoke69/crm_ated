/**
 * Netlify Scheduled Function: process-campaign-queue
 *
 * Roda a cada 1 minuto (configurado no netlify.toml) com timeout de 120s.
 * Processa jobs da fila campaign_contacts SEQUENCIALMENTE (um por vez).
 *
 * Fluxo:
 * 1. Recupera jobs travados (stale locks)
 * 2. Busca campanhas ativas com status 'running'
 * 3. Loop sequencial com time budget:
 *    - Busca 1 job devido (scheduled_at <= now, status = queued)
 *    - Processa o job (Evolution API)
 *    - Espera 1 segundo
 *    - Repete até acabar o tempo ou jobs
 * 4. Atualiza agregados e next_request_at
 */

import { createClient } from '@supabase/supabase-js';

// Tipo para o handler do Netlify
interface HandlerEvent {
  httpMethod?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
  queryStringParameters?: Record<string, string>;
}

interface HandlerContext {
  functionName?: string;
  requestId?: string;
}

interface HandlerResponse {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

type Handler = (event: HandlerEvent, context: HandlerContext) => Promise<HandlerResponse>;

// Cliente Supabase inicializado lazy dentro do handler para evitar throw no top-level.
let _supabaseClient: any = null;

function getSupabase(): any {
  if (_supabaseClient) return _supabaseClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    throw new Error('ENV AUSENTE: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias para process-campaign-queue');
  }
  _supabaseClient = createClient(url, key, { auth: { persistSession: false } });
  return _supabaseClient;
}

// Configurações
const LOCK_TTL_MINUTES = 3; // TTL do lock (recupera jobs travados após 3 min)
const FETCH_TIMEOUT_MS = 25000; // Timeout para Evolution API
const FUNCTION_TIMEOUT_MS = 110_000; // 110s (margem de 10s do limite de 120s)
const DELAY_BETWEEN_SENDS_MS = 1000; // 1 segundo entre envios

// Função auxiliar para normalizar telefone
function normalizePhoneNumber(phone: string): string {
  if (!phone) return '';
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('5555')) {
    cleaned = cleaned.substring(2);
  }
  if (cleaned.startsWith('55') && !cleaned.startsWith('5555')) {
    return cleaned;
  }
  return `55${cleaned}`;
}

// Função auxiliar para buscar string em objeto aninhado (incluindo arrays)
function containsStringInObject(obj: any, searchString: string): boolean {
  if (!obj) return false;

  if (typeof obj === 'string') {
    return obj.includes(searchString);
  }

  if (Array.isArray(obj)) {
    return obj.some(item => containsStringInObject(item, searchString));
  }

  if (typeof obj === 'object') {
    return Object.values(obj).some(value => containsStringInObject(value, searchString));
  }

  return false;
}

// Busca instâncias disponíveis da campanha
async function getAvailableInstances(
  userId: string,
  preferUserBinding: boolean,
  allowedInstanceNames: string[]
): Promise<any[]> {
  if (!allowedInstanceNames || allowedInstanceNames.length === 0) {
    return [];
  }

  let query = getSupabase()
    .from('evolution_instances')
    .select(`
      *,
      evolution_apis!inner (
        id,
        name,
        base_url,
        is_active
      )
    `)
    .eq('is_active', true)
    .eq('status', 'ok')
    .eq('evolution_apis.is_active', true)
    .or('is_locked.is.null,is_locked.eq.false')
    .not('apikey', 'is', null)
    .in('instance_name', allowedInstanceNames);

  if (preferUserBinding && userId) {
    const { data: userBindings } = await getSupabase()
      .from('user_evolution_apis')
      .select('evolution_api_id')
      .eq('user_id', userId);

    if (userBindings && userBindings.length > 0) {
      const userApiIds = (userBindings as Array<{ evolution_api_id: string | number }>)
        .map((b) => b.evolution_api_id);
      query = query.in('evolution_api_id', userApiIds);
    }
  }

  const { data: candidates, error } = await query;

  if (error || !candidates || candidates.length === 0) {
    return [];
  }

  const available = candidates.filter((inst: any) => {
    if (inst.is_locked === true) return false;
    if (inst.cooldown_until && new Date(inst.cooldown_until) > new Date()) return false;
    if (inst.daily_limit !== null && inst.sent_today >= inst.daily_limit) return false;
    return true;
  });

  return available;
}

// Seleciona instância baseado no distributionMode
async function pickInstanceByDistribution(
  userId: string,
  preferUserBinding: boolean,
  allowedInstanceNames: string[],
  distributionMode: 'sequential' | 'random',
  position: number
): Promise<any> {
  const available = await getAvailableInstances(userId, preferUserBinding, allowedInstanceNames);

  if (available.length === 0) {
    return null;
  }

  const sortedInstances = available.sort((a: any, b: any) => {
    return a.instance_name.localeCompare(b.instance_name);
  });

  if (distributionMode === 'sequential') {
    const instanceIndex = position % sortedInstances.length;
    return sortedInstances[instanceIndex];
  } else {
    const randomIndex = Math.floor(Math.random() * sortedInstances.length);
    return sortedInstances[randomIndex];
  }
}

// ─── Helper: marca job como failed ───
async function markJobFailed(jobId: string, contactId: string | null, error: string): Promise<void> {
  await getSupabase()
    .from('campaign_contacts')
    .update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      last_error: error,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  if (contactId) {
    await getSupabase()
      .from('searches')
      .update({
        status: 'erro',
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId);
  }
}

// ─── Processa um job individual ───
// NUNCA pausa a campanha. Apenas marca o job como success/failed.
// Retorna skipCampaign=true quando o problema é de instância (evita gastar tempo em jobs que vão falhar).
async function processJob(
  job: any,
  workerId: string
): Promise<{ success: boolean; error?: string; skipCampaign?: boolean }> {
  const { id, campaign_id, campaign_group_id, phone, contact_id, user_id, position } = job;

  try {
    // ── 1. Claim atômico ──
    const { data: claimed, error: claimErr } = await getSupabase()
      .from('campaign_contacts')
      .update({
        status: 'processing',
        locked_at: new Date().toISOString(),
        locked_by: workerId,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'queued')
      .select('id')
      .single();

    if (claimErr || !claimed) {
      console.log(`[WORKER ${workerId}] Job ${id}: já reivindicado, pulando.`);
      return { success: false, error: 'Job já reivindicado' };
    }

    // ── 2. Busca dados da campanha e grupo ──
    const [campaignResult, groupResult] = await Promise.all([
      getSupabase()
        .from('campaigns')
        .select('strategy, instances, group_id')
        .eq('id', campaign_id)
        .single(),
      getSupabase()
        .from('campaign_groups')
        .select('group_jid, group_subject')
        .eq('id', campaign_group_id)
        .single(),
    ]);

    if (campaignResult.error || !campaignResult.data) {
      await markJobFailed(id, contact_id, `Campanha não encontrada: ${campaignResult.error?.message}`);
      return { success: false, error: 'Campanha não encontrada' };
    }

    if (groupResult.error || !groupResult.data) {
      await markJobFailed(id, contact_id, `Grupo não encontrado: ${groupResult.error?.message}`);
      return { success: false, error: 'Grupo não encontrado' };
    }

    const campaign = campaignResult.data;
    const group = groupResult.data;
    const strategy = campaign.strategy || {};
    const allowedInstances = campaign.instances || [];

    if (!Array.isArray(allowedInstances) || allowedInstances.length === 0) {
      await markJobFailed(id, contact_id, 'Campanha sem instâncias configuradas');
      return { success: false, error: 'Sem instâncias configuradas', skipCampaign: true };
    }

    // ── 3. Seleciona instância ──
    const distributionMode = strategy.distributionMode || 'sequential';
    const preferUserBinding = strategy.preferUserBinding === true;
    const instance = await pickInstanceByDistribution(
      user_id,
      preferUserBinding,
      allowedInstances,
      distributionMode,
      position || 0
    );

    if (!instance) {
      await markJobFailed(id, contact_id, 'Nenhuma instância disponível no momento');
      // skipCampaign: não adianta tentar mais jobs desta campanha nesta execução
      return { success: false, error: 'Nenhuma instância disponível', skipCampaign: true };
    }

    // ── 4. Prepara request para Evolution API ──
    const evolutionApi = Array.isArray(instance.evolution_apis)
      ? instance.evolution_apis[0]
      : instance.evolution_apis;

    if (!evolutionApi?.base_url) {
      await markJobFailed(id, contact_id, 'Evolution API sem base_url');
      return { success: false, error: 'API sem base_url', skipCampaign: true };
    }

    const instanceApikey = instance.apikey;
    if (!instanceApikey) {
      await markJobFailed(id, contact_id, 'Instância sem apikey');
      return { success: false, error: 'Sem apikey', skipCampaign: true };
    }

    const normalizedPhone = normalizePhoneNumber(phone);
    const groupJid = group.group_jid;
    const normalizedBaseUrl = evolutionApi.base_url
      .replace(/\/+$/, '')
      .replace(/([^:]\/)\/+/g, '$1');

    const url = `${normalizedBaseUrl}/group/updateParticipant/${instance.instance_name}?groupJid=${encodeURIComponent(groupJid)}`;

    // ── 5. Faz request à Evolution API ──
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: instanceApikey,
        },
        body: JSON.stringify({
          action: 'add',
          participants: [normalizedPhone],
        }),
        signal: controller.signal,
      });
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      const errorMsg = fetchError?.message || String(fetchError);
      console.error(`[WORKER ${workerId}] Job ${id}: FETCH ERROR - ${errorMsg}`);
      await markJobFailed(id, contact_id, errorMsg);
      // Não faz skipCampaign: pode ser erro transitório de rede
      return { success: false, error: errorMsg };
    }

    clearTimeout(timeoutId);

    const responseText = await response.text();
    let responseData: any = {};
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { message: responseText };
    }

    // ── 6. Trata resposta ──
    if (response.ok) {
      const statusCode = responseData?.updateParticipants?.[0]?.status;
      const isSuccess = statusCode === '200' || statusCode === 200 || (!statusCode && response.ok);

      if (statusCode === '409' || !isSuccess) {
        const errorMsg = responseData?.message || responseText || `Status: ${statusCode}`;
        console.warn(`[WORKER ${workerId}] Job ${id}: contato não adicionado. Status: ${statusCode}`);
        await markJobFailed(id, contact_id, errorMsg);
        return { success: false, error: errorMsg };
      }

      // ✅ SUCESSO
      await getSupabase()
        .from('campaign_contacts')
        .update({
          status: 'success',
          finished_at: new Date().toISOString(),
          instance_name: instance.instance_name,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (contact_id) {
        await getSupabase()
          .from('searches')
          .update({
            status_add_gp: true,
            status: 'added',
            updated_at: new Date().toISOString(),
          })
          .eq('id', contact_id);
      }

      console.log(`[WORKER ${workerId}] Job ${id}: ✅ Sucesso (instância: ${instance.instance_name})`);
      return { success: true };
    }

    // ── 7. Resposta HTTP não-ok ──
    const errorMsg = responseData.message || responseText || `HTTP ${response.status}`;

    // Verifica se Connection Closed indica instância desconectada
    const isConnectionClosed =
      containsStringInObject(responseData, 'Connection Closed') ||
      containsStringInObject(responseData, 'blocked-integrity-enforcement') ||
      (typeof responseText === 'string' && responseText.includes('Connection Closed'));

    if (isConnectionClosed) {
      console.warn(`[WORKER ${workerId}] Job ${id}: Connection Closed detectado na instância ${instance.instance_name}. Verificando status real...`);

      // Verifica status real da instância (sem pausar campanha)
      try {
        const { data: apiData } = await getSupabase()
          .from('evolution_apis')
          .select('api_key_global')
          .eq('id', evolutionApi.id)
          .single();

        if (apiData?.api_key_global) {
          const statusUrl = `${normalizedBaseUrl}/instance/connectionState/${instance.instance_name}`;
          const statusResponse = await fetch(statusUrl, {
            method: 'GET',
            headers: { apikey: apiData.api_key_global },
            cache: 'no-store',
          });

          if (statusResponse.ok) {
            const statusData = await statusResponse.json();
            const stateRaw = (
              statusData?.instance?.status ||
              statusData?.state ||
              statusData?.connection?.state ||
              ''
            ).toString().toLowerCase();

            const isDisconnected = ['close', 'closed', 'disconnected', 'logout', 'offline'].includes(stateRaw);

            if (isDisconnected) {
              console.error(`[WORKER ${workerId}] Instância ${instance.instance_name} CONFIRMADA desconectada. Marcando no DB.`);
              await getSupabase()
                .from('evolution_instances')
                .update({
                  status: 'disconnected',
                  is_active: false,
                  updated_at: new Date().toISOString(),
                })
                .eq('instance_name', instance.instance_name);
            } else {
              console.log(`[WORKER ${workerId}] Instância ${instance.instance_name} ainda ${stateRaw}. Erro transitório.`);
            }
          }
        }
      } catch (verifyError: any) {
        console.error(`[WORKER ${workerId}] Erro ao verificar status da instância:`, verifyError.message);
      }

      await markJobFailed(id, contact_id, errorMsg);
      // skipCampaign: se a instância caiu, não adianta tentar mais nesta execução
      return { success: false, error: errorMsg, skipCampaign: true };
    }

    // Erro genérico (400, 500, etc.) - marca failed e continua
    console.warn(`[WORKER ${workerId}] Job ${id}: HTTP ${response.status} - ${errorMsg}`);
    await markJobFailed(id, contact_id, errorMsg);
    return { success: false, error: errorMsg };

  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    console.error(`[WORKER ${workerId}] Job ${id}: ERRO - ${errorMsg}`);
    await markJobFailed(id, contact_id, errorMsg);
    return { success: false, error: errorMsg };
  }
}

// ─── Atualiza agregados (campaigns e campaign_groups) ───
async function updateAggregates(campaignId: string, workerId: string): Promise<void> {
  try {
    const { data: jobStats, error: statsError } = await getSupabase()
      .from('campaign_contacts')
      .select('status, campaign_group_id')
      .eq('campaign_id', campaignId);

    if (statsError) {
      console.error(`[WORKER ${workerId}] Erro ao buscar stats:`, statsError);
      return;
    }

    if (!jobStats || jobStats.length === 0) {
      await getSupabase()
        .from('campaigns')
        .update({
          processed_contacts: 0,
          failed_contacts: 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaignId);
      return;
    }

    const groupStats = new Map<string, { processed: number; failed: number }>();
    let totalProcessed = 0;
    let totalFailed = 0;
    let queuedCount = 0;

    jobStats.forEach((job: any) => {
      if (!job.campaign_group_id) return;

      if (!groupStats.has(job.campaign_group_id)) {
        groupStats.set(job.campaign_group_id, { processed: 0, failed: 0 });
      }
      const stats = groupStats.get(job.campaign_group_id)!;

      if (job.status === 'success') {
        stats.processed++;
        totalProcessed++;
      } else if (job.status === 'failed') {
        stats.failed++;
        totalFailed++;
      } else if (job.status === 'queued') {
        queuedCount++;
      }
    });

    console.log(`[WORKER ${workerId}] 📊 Campanha ${campaignId}: ${totalProcessed} ok, ${totalFailed} falhas, ${queuedCount} na fila, total: ${jobStats.length}`);

    // Atualiza campaign_groups
    for (const [groupId, stats] of groupStats.entries()) {
      const { error: groupError } = await getSupabase()
        .from('campaign_groups')
        .update({
          processed_contacts: stats.processed,
          failed_contacts: stats.failed,
          updated_at: new Date().toISOString(),
        })
        .eq('id', groupId);

      if (groupError) {
        console.error(`[WORKER ${workerId}] Erro ao atualizar grupo ${groupId}:`, groupError);
      }
    }

    // Atualiza campaigns
    const { error: campaignError } = await getSupabase()
      .from('campaigns')
      .update({
        processed_contacts: totalProcessed,
        failed_contacts: totalFailed,
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaignId);

    if (campaignError) {
      console.error(`[WORKER ${workerId}] Erro ao atualizar campanha ${campaignId}:`, campaignError);
    }

    // Verifica se deve finalizar campanha
    const { data: finalizeResult, error: finalizeError } = await getSupabase().rpc(
      'finalizar_campaign_se_necessario',
      { p_campaign_id: campaignId }
    );

    if (finalizeError) {
      console.error(`[WORKER ${workerId}] Erro ao verificar finalização: ${finalizeError.message}`);
    } else if (finalizeResult) {
      console.log(`[WORKER ${workerId}] ✅ Campanha ${campaignId} finalizada`);
    }
  } catch (error: any) {
    console.error(`[WORKER ${workerId}] Erro ao atualizar agregados:`, error?.message || error);
  }
}

// ─── Handler principal ───
// Processamento SEQUENCIAL com time budget de 110s.
// Loop: busca 1 job → processa → espera 1s → repete.
export const handler: Handler = async (event, context) => {
  const WORKER_ID = `netlify-worker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const startMs = Date.now();

  console.log(`[WORKER ${WORKER_ID}] ▶ Iniciando | ${new Date(startMs).toISOString()}`);

  try {
    // PASSO 0: Converte jobs retry → failed (migração)
    const { error: convertError } = await getSupabase()
      .from('campaign_contacts')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        last_error: 'Job convertido de retry para failed',
        updated_at: new Date().toISOString(),
      })
      .eq('status', 'retry');

    if (convertError) {
      console.warn(`[WORKER ${WORKER_ID}] Aviso ao converter retry:`, convertError.message);
    }

    // PASSO 0.5: Recupera jobs travados em 'processing' há mais de LOCK_TTL_MINUTES
    const staleThreshold = new Date(Date.now() - LOCK_TTL_MINUTES * 60 * 1000).toISOString();
    const { data: staleJobs, error: staleError } = await getSupabase()
      .from('campaign_contacts')
      .update({
        status: 'queued',
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq('status', 'processing')
      .lt('locked_at', staleThreshold)
      .select('id');

    if (staleError) {
      console.warn(`[WORKER ${WORKER_ID}] Aviso ao recuperar stale locks:`, staleError.message);
    } else if (staleJobs && staleJobs.length > 0) {
      console.log(`[WORKER ${WORKER_ID}] 🔓 ${staleJobs.length} jobs travados recuperados`);
    }

    // PASSO 1: Busca campanhas ativas com status 'running'
    const { data: activeCampaigns, error: campaignsError } = await getSupabase()
      .from('campaigns')
      .select('id')
      .eq('status', 'running');

    if (campaignsError) {
      console.error(`[WORKER ${WORKER_ID}] Erro ao buscar campanhas: ${campaignsError.message}`);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: campaignsError.message, workerId: WORKER_ID }),
      };
    }

    if (!activeCampaigns || activeCampaigns.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Nenhuma campanha ativa', processed: 0, workerId: WORKER_ID }),
      };
    }

    const activeCampaignIds = activeCampaigns.map((c: { id: string }) => c.id);
    console.log(`[WORKER ${WORKER_ID}] Campanhas ativas: ${activeCampaignIds.length}`);

    // PASSO 2: Loop sequencial com time budget
    const skippedCampaigns = new Set<string>();
    const processedCampaigns = new Set<string>();
    let totalSuccess = 0;
    let totalFailed = 0;

    while (true) {
      // Verifica se ainda tem tempo (precisa de pelo menos 8s para processar + atualizar agregados)
      const elapsed = Date.now() - startMs;
      if (elapsed > FUNCTION_TIMEOUT_MS - 8000) {
        console.log(`[WORKER ${WORKER_ID}] ⏱️ Time budget esgotado (${elapsed}ms). Parando loop.`);
        break;
      }

      // Filtra campanhas que não foram skipadas
      const eligibleIds = activeCampaignIds.filter((id: string) => !skippedCampaigns.has(id));
      if (eligibleIds.length === 0) {
        console.log(`[WORKER ${WORKER_ID}] Todas as campanhas foram skipadas nesta execução.`);
        break;
      }

      // Busca 1 job devido
      const now = new Date().toISOString();
      const { data: job, error: fetchError } = await getSupabase()
        .from('campaign_contacts')
        .select('*')
        .eq('status', 'queued')
        .lte('scheduled_at', now)
        .in('campaign_id', eligibleIds)
        .order('position', { ascending: true })
        .limit(1)
        .single();

      if (fetchError || !job) {
        // Nenhum job devido no momento
        console.log(`[WORKER ${WORKER_ID}] Nenhum job devido. Encerrando loop.`);
        break;
      }

      // Processa o job
      processedCampaigns.add(job.campaign_id);
      const result = await processJob(job, WORKER_ID);

      if (result.success) {
        totalSuccess++;
      } else {
        totalFailed++;
        if (result.skipCampaign) {
          skippedCampaigns.add(job.campaign_id);
          console.log(`[WORKER ${WORKER_ID}] ⏭️ Campanha ${job.campaign_id} skipada: ${result.error}`);
        }
      }

      // Espera antes do próximo envio (se tiver tempo)
      const timeLeft = FUNCTION_TIMEOUT_MS - (Date.now() - startMs);
      if (timeLeft > DELAY_BETWEEN_SENDS_MS + 8000) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_SENDS_MS));
      } else {
        break;
      }
    }

    // PASSO 3: Atualiza agregados e next_request_at para cada campanha processada
    for (const campaignId of processedCampaigns) {
      await updateAggregates(campaignId, WORKER_ID);

      // Atualiza next_request_at com o próximo job pendente
      const { data: nextJob } = await getSupabase()
        .from('campaign_contacts')
        .select('scheduled_at')
        .eq('campaign_id', campaignId)
        .eq('status', 'queued')
        .order('position', { ascending: true })
        .limit(1)
        .single();

      await getSupabase()
        .from('campaigns')
        .update({
          next_request_at: nextJob?.scheduled_at || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaignId)
        .eq('status', 'running');
    }

    const duration = Date.now() - startMs;
    console.log(`[WORKER ${WORKER_ID}] ◼ Concluído em ${duration}ms | ${totalSuccess} ok, ${totalFailed} falhas | campanhas: ${Array.from(processedCampaigns).join(', ')}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Processamento concluído',
        success: totalSuccess,
        failed: totalFailed,
        duration: `${duration}ms`,
        workerId: WORKER_ID,
        campaigns: Array.from(processedCampaigns),
        skipped: Array.from(skippedCampaigns),
      }),
    };
  } catch (error: any) {
    console.error(`[WORKER ${WORKER_ID}] ERRO FATAL: ${error?.message || 'Erro desconhecido'}`);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error?.message || 'Erro desconhecido',
        workerId: WORKER_ID,
        duration: `${Date.now() - startMs}ms`,
      }),
    };
  }
};
