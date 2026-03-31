import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { canAccessUser, isAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const QUEUE_WORKER_URL = process.env.PROCESS_CAMPAIGN_QUEUE_URL || process.env.NEXT_PUBLIC_PROCESS_CAMPAIGN_QUEUE_URL || '';

/**
 * Dispara o worker da fila em fire-and-forget (fallback ao cron).
 */
function triggerQueueWorker(campaignId: string): void {
  const url = QUEUE_WORKER_URL.trim();
  if (!url || !url.startsWith('http')) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal })
    .then(() => console.log(`[QUEUE-TRIGGER] Worker disparado após resume (campanha ${campaignId})`))
    .catch(() => {})
    .finally(() => clearTimeout(timeout));
}

/**
 * Função auxiliar para recalcular métricas de uma campanha
 * Busca diretamente do banco de dados para garantir precisão
 */
export async function recalculateCampaignMetrics(campaignId: string): Promise<{ processed: number; failed: number }> {
  // Busca TODOS os jobs da campanha diretamente do banco
  // Busca também attempts para debug
  // Adiciona retry em caso de erro de rede
  let jobStats: any[] | null = null;
  let statsError: any = null;
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    const { data, error } = await supabaseServiceRole
      .from('campaign_contacts')
      .select('status, campaign_group_id, attempts, last_error')
      .eq('campaign_id', campaignId);

    if (!error) {
      jobStats = data;
      break;
    }

    statsError = error;

    // Verifica se é erro de rede (fetch failed) e tenta novamente
    const isNetworkError =
      error?.message?.includes('fetch failed') ||
      error?.message?.includes('ECONNREFUSED') ||
      error?.message?.includes('ECONNRESET') ||
      error?.message?.includes('ETIMEDOUT') ||
      error?.message?.includes('ENOTFOUND');

    if (isNetworkError && retryCount < maxRetries - 1) {
      retryCount++;
      const delayMs = retryCount * 1000; // Backoff exponencial: 1s, 2s, 3s
      console.warn(`⚠️ Erro de rede ao buscar métricas da campanha ${campaignId}. Tentativa ${retryCount}/${maxRetries}. Aguardando ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      continue;
    }

    // Se não é erro de rede ou já tentou todas as vezes, loga e sai
    break;
  }

  if (statsError) {
    const cause = (statsError as any)?.cause;
    const errorDetails = {
      message: statsError.message,
      details: statsError.details,
      hint: statsError.hint,
      code: statsError.code,
      cause: cause != null ? String(cause?.message ?? cause) : undefined,
      campaignId,
      retryCount,
    };
    console.error(`❌ Erro ao recalcular métricas da campanha ${campaignId} após ${retryCount + 1} tentativa(s):`, errorDetails);
    return { processed: 0, failed: 0 };
  }

  if (!jobStats || jobStats.length === 0) {
    // Se não há jobs, zera as métricas
    // Adiciona retry em caso de erro de rede
    let zeroUpdateError: any = null;
    const maxZeroRetries = 3;
    let zeroRetryCount = 0;

    while (zeroRetryCount < maxZeroRetries) {
      const { error } = await supabaseServiceRole
        .from('campaigns')
        .update({
          processed_contacts: 0,
          failed_contacts: 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaignId);

      if (!error) {
        break;
      }

      zeroUpdateError = error;

      const isNetworkError =
        error?.message?.includes('fetch failed') ||
        error?.message?.includes('ECONNREFUSED') ||
        error?.message?.includes('ECONNRESET') ||
        error?.message?.includes('ETIMEDOUT') ||
        error?.message?.includes('ENOTFOUND');

      if (isNetworkError && zeroRetryCount < maxZeroRetries - 1) {
        zeroRetryCount++;
        const delayMs = zeroRetryCount * 1000;
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }

      break;
    }

    if (zeroUpdateError) {
      console.warn(`⚠️ Erro ao zerar métricas da campanha ${campaignId} (sem jobs):`, zeroUpdateError.message);
    }

    return { processed: 0, failed: 0 };
  }

  let totalProcessed = 0;
  let totalFailed = 0;
  let queuedCount = 0;

  jobStats.forEach((job: any) => {
    // Conta apenas jobs finalizados (success ou failed)
    // Jobs com status 'queued' não são contabilizados ainda
    if (job.status === 'success') {
      totalProcessed++;
    } else if (job.status === 'failed') {
      totalFailed++;
    } else if (job.status === 'queued') {
      queuedCount++;
    }
    // Jobs com status 'retry' não existem mais - foram removidos
  });

  // Log para debug (apenas se as métricas estiverem zeradas mas há jobs)
  if (totalProcessed === 0 && totalFailed === 0 && jobStats.length > 0) {
  }

  // Atualiza a campanha com as métricas recalculadas
  // Adiciona retry em caso de erro de rede (fetch failed)
  let updateError: any = null;
  const maxUpdateRetries = 3;
  let updateRetryCount = 0;

  while (updateRetryCount < maxUpdateRetries) {
    const { error } = await supabaseServiceRole
      .from('campaigns')
      .update({
        processed_contacts: totalProcessed,
        failed_contacts: totalFailed,
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaignId);

    if (!error) {
      // Sucesso - sai do loop
      break;
    }

    updateError = error;

    // Verifica se é erro de rede (fetch failed) e tenta novamente
    const isNetworkError =
      error?.message?.includes('fetch failed') ||
      error?.message?.includes('ECONNREFUSED') ||
      error?.message?.includes('ECONNRESET') ||
      error?.message?.includes('ETIMEDOUT') ||
      error?.message?.includes('ENOTFOUND');

    if (isNetworkError && updateRetryCount < maxUpdateRetries - 1) {
      updateRetryCount++;
      const delayMs = updateRetryCount * 1000; // Backoff exponencial: 1s, 2s, 3s
      console.warn(`⚠️ Erro de rede ao atualizar métricas da campanha ${campaignId}. Tentativa ${updateRetryCount}/${maxUpdateRetries}. Aguardando ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      continue;
    }

    // Se não é erro de rede ou já tentou todas as vezes, loga e sai
    break;
  }

  if (updateError) {
    // Log detalhado do erro
    const errorDetails = {
      message: updateError.message,
      details: updateError.details,
      hint: updateError.hint,
      code: updateError.code,
      campaignId,
      retryCount: updateRetryCount,
    };
    console.error(`❌ Erro ao atualizar métricas da campanha ${campaignId} após ${updateRetryCount + 1} tentativa(s):`, errorDetails);
  }

  return { processed: totalProcessed, failed: totalFailed };
}

/**
 * GET /api/campaigns/[campaignId] - Busca uma campanha específica
 * Recalcula métricas sempre que buscar para garantir dados atualizados
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { campaignId } = await params;

    // Busca campanha
    const { data, error } = await supabaseServiceRole
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();

    if (error || !data) {
      return errorResponse('Campanha não encontrada', 404);
    }

    // Verifica permissão: Admin pode ver tudo, outros só veem suas próprias campanhas ou de subordinados
    const isUserAdmin = await isAdmin(userId);
    if (!isUserAdmin && data.user_id !== userId) {
      // Verifica se o usuário pode acessar o dono da campanha
      const canAccess = await canAccessUser(userId, data.user_id);
      if (!canAccess) {
        return errorResponse('Acesso negado. Você não tem permissão para acessar esta campanha.', 403);
      }
    }

    // CRÍTICO: Recalcula métricas sempre que buscar a campanha
    // Isso garante que os dados estejam sempre atualizados, mesmo se houver processamentos paralelos
    const metrics = await recalculateCampaignMetrics(campaignId);

    // Atualiza os dados da campanha com as métricas recalculadas
    const updatedCampaign = {
      ...data,
      processed_contacts: metrics.processed,
      failed_contacts: metrics.failed,
    };

    return successResponse(updatedCampaign);
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar campanha', 401);
  }
}

/**
 * PATCH /api/campaigns/[campaignId] - Atualiza status de uma campanha
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { campaignId } = await params;
    const body = await req.json();
    const { status, processedContacts, failedContacts, instances, strategy } = body;

    // Remove userId do body se foi enviado (já foi usado na autenticação)
    // para não interferir com o processamento
    delete body.userId;

    // Busca campanha atual para validar transições de status e obter estratégia
    const { data: currentCampaign } = await supabaseServiceRole
      .from('campaigns')
      .select('status, strategy, user_id')
      .eq('id', campaignId)
      .single();

    if (!currentCampaign) {
      return errorResponse('Campanha não encontrada', 404);
    }

    // Verifica permissão
    const isUserAdmin = await isAdmin(userId);
    if (!isUserAdmin && currentCampaign.user_id !== userId) {
      const canAccess = await canAccessUser(userId, currentCampaign.user_id);
      if (!canAccess) {
        return errorResponse('Acesso negado. Você não tem permissão para acessar esta campanha.', 403);
      }
    }

    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (status) {
      // Valida transições de status
      const currentStatus = currentCampaign.status;
      const validTransitions: Record<string, string[]> = {
        pending: ['running', 'failed'],
        running: ['paused', 'completed', 'failed'],
        paused: ['running', 'failed'],
        completed: [], // Não pode mudar de completed
        failed: ['pending', 'running'], // Pode retentar
      };

      // Permite manter o mesmo status (sem transição)
      if (currentStatus === status || validTransitions[currentStatus]?.includes(status)) {
        updateData.status = status;

        // Função auxiliar para reagendar jobs e calcular next_request_at
        const rescheduleJobsAndSetNextRequest = async () => {
          const strategy = currentCampaign.strategy || {};
          const intervalMinutes = strategy.interval_minutes || 1;
          const intervalMs = intervalMinutes * 60 * 1000;
          const now = new Date();

          // Detecta modo de delay para respeitar randomização no reagendamento
          const delayConfig = strategy.delayConfig || {};
          const isRandomDelay = delayConfig.delayMode === 'random';
          const randomMinMs = (delayConfig.randomMinSeconds || 5) * 1000;
          const randomMaxMs = (delayConfig.randomMaxSeconds || 300) * 1000;

          // Busca todos os jobs pendentes da campanha (em ordem de posição)
          const { data: pendingJobs, error: jobsError } = await supabaseServiceRole
            .from('campaign_contacts')
            .select('id, position, scheduled_at')
            .eq('campaign_id', campaignId)
            .eq('status', 'queued')
            .order('position', { ascending: true });

          if (!jobsError && pendingJobs && pendingJobs.length > 0) {
            console.log(`📦 [CAMPANHA ${campaignId}] Encontrados ${pendingJobs.length} jobs para reagendar.`);

            // SEMPRE reagenda jobs com scheduled_at no passado, independente de haver jobs no futuro.
            const pastJobs = pendingJobs.filter(job => {
              if (!job.scheduled_at) return true;
              const scheduled = new Date(job.scheduled_at).getTime();
              return scheduled <= now.getTime();
            });

            const futureJobs = pendingJobs.filter(job => {
              if (!job.scheduled_at) return false;
              const scheduled = new Date(job.scheduled_at).getTime();
              return scheduled > now.getTime();
            });

            let firstNextScheduledAt: Date;

            if (pastJobs.length > 0) {
              // Reagenda todos os jobs atrasados a partir de agora, respeitando o intervalo
              // Para random, gera delays aleatórios entre min e max para cada job
              let cumulativeMs = 0;
              const scheduledTimes: Date[] = [];

              for (let idx = 0; idx < pastJobs.length; idx++) {
                if (isRandomDelay) {
                  cumulativeMs += randomMinMs + Math.random() * (randomMaxMs - randomMinMs);
                } else {
                  cumulativeMs += intervalMs;
                }
                scheduledTimes.push(new Date(now.getTime() + cumulativeMs));
              }

              firstNextScheduledAt = scheduledTimes[0];

              const BATCH_SIZE = 50;
              for (let i = 0; i < pastJobs.length; i += BATCH_SIZE) {
                const batch = pastJobs.slice(i, i + BATCH_SIZE);
                await Promise.all(batch.map((job, index) => {
                  const globalIndex = i + index;
                  return supabaseServiceRole
                    .from('campaign_contacts')
                    .update({
                      scheduled_at: scheduledTimes[globalIndex].toISOString(),
                      updated_at: now.toISOString()
                    })
                    .eq('id', job.id);
                }));
              }
            } else if (futureJobs.length > 0) {
              // Todos os jobs ainda estão no futuro — usa o primeiro como referência
              const firstFutureJob = futureJobs.sort((a, b) => {
                const aTime = new Date(a.scheduled_at!).getTime();
                const bTime = new Date(b.scheduled_at!).getTime();
                return aTime - bTime;
              })[0];
              firstNextScheduledAt = new Date(firstFutureJob.scheduled_at!);
            } else {
              firstNextScheduledAt = new Date(now.getTime() + intervalMs);
            }

            // Atualiza next_request_at da campanha para o tempo do primeiro job
            updateData.next_request_at = firstNextScheduledAt.toISOString();
          } else {
            // Se não há mais jobs pendentes, tenta buscar o próximo job agendado
            const { data: nextJob } = await supabaseServiceRole
              .from('campaign_contacts')
              .select('scheduled_at')
              .eq('campaign_id', campaignId)
              .eq('status', 'queued')
              .not('scheduled_at', 'is', null)
              .gt('scheduled_at', now.toISOString())
              .order('scheduled_at', { ascending: true })
              .limit(1)
              .single();

            if (nextJob?.scheduled_at) {
              updateData.next_request_at = nextJob.scheduled_at;
            } else {
              // Se não há mais jobs pendentes, limpa next_request_at
              updateData.next_request_at = null;
            }
          }
        };

        if (status === 'running' && (currentStatus === 'paused' || currentStatus === 'failed')) {
          // Retomando campanha pausada ou reativando campanha falhada
          if (currentStatus === 'paused') {
            // Mantém o started_at original ao retomar de paused
            await rescheduleJobsAndSetNextRequest();
          } else if (currentStatus === 'failed') {
            // Reativando campanha falhada
            await rescheduleJobsAndSetNextRequest();
          }
        } else if (status === 'paused') {
          // Limpa next_request_at ao pausar para não mostrar timer antigo
          updateData.next_request_at = null;
        } else if (status === 'running' && currentStatus !== 'paused' && currentStatus !== 'failed' && !body.started_at) {
          updateData.started_at = new Date().toISOString();
        }

        if (status === 'completed' || status === 'failed') {
          updateData.completed_at = new Date().toISOString();
        }
      } else {
        return errorResponse(
          `Transição de status inválida: ${currentStatus} -> ${status}`,
          400
        );
      }
    }

    if (typeof processedContacts === 'number') {
      updateData.processed_contacts = processedContacts;
    }

    if (typeof failedContacts === 'number') {
      updateData.failed_contacts = failedContacts;
    }

    // Permite atualizar instâncias
    if (Array.isArray(instances) && instances.length > 0) {
      updateData.instances = instances;
    }

    // Permite atualizar estratégia
    if (strategy && typeof strategy === 'object') {
      // Merge da estratégia existente com a nova
      const currentStrategy = currentCampaign.strategy || {};
      const mergedStrategy = {
        ...currentStrategy,
        ...strategy,
      };

      // Se delayConfig foi passado, faz merge também
      if (strategy.delayConfig) {
        mergedStrategy.delayConfig = {
          ...(currentStrategy.delayConfig || {}),
          ...strategy.delayConfig,
        };
      }

      // Calcula interval_minutes baseado no delayConfig
      if (mergedStrategy.delayConfig) {
        if (mergedStrategy.delayConfig.delayMode === 'fixed') {
          const delayValue = mergedStrategy.delayConfig.delayValue || 1;
          const delayUnit = mergedStrategy.delayConfig.delayUnit || 'minutes';
          mergedStrategy.interval_minutes = delayUnit === 'minutes'
            ? delayValue
            : Math.ceil(delayValue / 60);
        } else if (mergedStrategy.delayConfig.delayMode === 'random') {
          // Para random, usa média (mínimo + máximo) / 2 em minutos
          const min = mergedStrategy.delayConfig.randomMinSeconds || 5;
          const max = mergedStrategy.delayConfig.randomMaxSeconds || 300;
          const avgSeconds = (min + max) / 2;
          mergedStrategy.interval_minutes = Math.ceil(avgSeconds / 60);
        }
      }

      updateData.strategy = mergedStrategy;

      // CRÍTICO: Se a strategy mudou numa campanha ativa (running/paused),
      // reagenda os jobs pendentes com os novos tempos de delay.
      // Sem isso, mudar o delay no modal não surte efeito nos jobs já agendados.
      const effectiveStatus = status || currentCampaign.status;
      if (effectiveStatus === 'running' || effectiveStatus === 'paused') {
        const delayConf = mergedStrategy.delayConfig || {};
        const isRandom = delayConf.delayMode === 'random';
        const rndMinMs = (delayConf.randomMinSeconds || 5) * 1000;
        const rndMaxMs = (delayConf.randomMaxSeconds || 300) * 1000;
        const fixedIntervalMs = (mergedStrategy.interval_minutes || 1) * 60 * 1000;
        const nowMs = Date.now();

        const { data: pendingJobs } = await supabaseServiceRole
          .from('campaign_contacts')
          .select('id, position')
          .eq('campaign_id', campaignId)
          .eq('status', 'queued')
          .order('position', { ascending: true });

        if (pendingJobs && pendingJobs.length > 0) {
          let cumulativeMs = 0;
          const BATCH_SIZE = 50;
          for (let i = 0; i < pendingJobs.length; i += BATCH_SIZE) {
            const batch = pendingJobs.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map((job, index) => {
              const globalIndex = i + index;
              if (globalIndex === 0) {
                // Primeiro job pendente: agenda logo
                cumulativeMs = isRandom
                  ? rndMinMs + Math.random() * (rndMaxMs - rndMinMs)
                  : fixedIntervalMs;
              }
              const scheduledAt = new Date(nowMs + cumulativeMs);
              // Calcula delay para o próximo
              if (isRandom) {
                cumulativeMs += rndMinMs + Math.random() * (rndMaxMs - rndMinMs);
              } else {
                cumulativeMs += fixedIntervalMs;
              }
              return supabaseServiceRole
                .from('campaign_contacts')
                .update({
                  scheduled_at: scheduledAt.toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .eq('id', job.id);
            }));
          }
          // Atualiza next_request_at para o primeiro job pendente
          const firstScheduled = new Date(nowMs + (isRandom
            ? rndMinMs + Math.random() * (rndMaxMs - rndMinMs)
            : fixedIntervalMs));
          updateData.next_request_at = new Date(nowMs + (isRandom ? rndMinMs : fixedIntervalMs)).toISOString();
          console.log(`🔄 [CAMPANHA ${campaignId}] Reagendados ${pendingJobs.length} jobs com novo delay.`);
        }
      }
    }


    const { data, error } = await supabaseServiceRole
      .from('campaigns')
      .update(updateData)
      .eq('id', campaignId)
      .select()
      .single();

    if (error) {
      return errorResponse(`Erro ao atualizar campanha: ${error.message}`);
    }

    // CRÍTICO: Se o status foi atualizado (especialmente para paused/failed/completed),
    // força um recálculo das métricas para garantir que o banco reflita a realidade dos jobs
    if (status) {
      console.log(`🔄 [API] Status alterado para ${status}. Recalculando métricas da campanha ${campaignId}...`);
      const metrics = await recalculateCampaignMetrics(campaignId);

      if (data) {
        data.processed_contacts = metrics.processed;
        data.failed_contacts = metrics.failed;
      }

      // Ao retomar para 'running', dispara o worker em background (fallback ao cron)
      if (status === 'running') {
        triggerQueueWorker(campaignId);
      }
    }

    return successResponse(data, 'Campanha atualizada com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * DELETE /api/campaigns/[campaignId] - Exclui uma campanha
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { campaignId } = await params;

    if (!campaignId) {
      return errorResponse('ID da campanha é obrigatório', 400);
    }

    console.log(`🗑️ Tentando excluir campanha: ${campaignId} para usuário: ${userId}`);

    // Verifica se a campanha existe
    const { data: campaign, error: checkError } = await supabaseServiceRole
      .from('campaigns')
      .select('id, status, user_id')
      .eq('id', campaignId)
      .single();

    if (checkError) {
      return errorResponse(`Erro ao verificar campanha: ${checkError.message}`, 500);
    }

    if (!campaign) {
      return errorResponse('Campanha não encontrada', 404);
    }

    // Verifica permissão: Admin pode deletar tudo, outros só suas próprias campanhas ou de subordinados
    const isUserAdmin = await isAdmin(userId);
    if (!isUserAdmin && campaign.user_id !== userId) {
      const canAccess = await canAccessUser(userId, campaign.user_id);
      if (!canAccess) {
        return errorResponse('Acesso negado. Você não tem permissão para excluir esta campanha.', 403);
      }
    }

    console.log(`📋 Campanha encontrada: ${campaignId}, Status: ${campaign.status}`);

    // Se a campanha estiver em execução ou pausada, marca como failed antes de excluir
    if (campaign.status === 'running' || campaign.status === 'paused') {
      const { error: updateError } = await supabaseServiceRole
        .from('campaigns')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaignId)
        .eq('user_id', userId);

      if (updateError) {
        return errorResponse(`Erro ao atualizar status da campanha: ${updateError.message}`, 500);
      }
    }

    // Exclui a campanha
    console.log(`🗑️ Excluindo campanha: ${campaignId}`);
    const { error, data } = await supabaseServiceRole
      .from('campaigns')
      .delete()
      .eq('user_id', userId)
      .eq('id', campaignId)
      .select();

    if (error) {
      console.error('❌ Erro ao excluir campanha:', error);
      return errorResponse(`Erro ao excluir campanha: ${error.message}`, 500);
    }

    if (!data || data.length === 0) {
      return errorResponse('Campanha não encontrada ou já foi excluída', 404);
    }

    return successResponse({ id: campaignId }, 'Campanha excluída com sucesso');
  } catch (err: any) {
    console.error('❌ Erro inesperado ao excluir campanha:', err);
    return serverErrorResponse(err);
  }
}

