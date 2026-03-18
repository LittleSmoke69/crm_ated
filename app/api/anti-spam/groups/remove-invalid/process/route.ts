/**
 * POST /api/anti-spam/groups/remove-invalid/process
 * Rota interna: executa a remoção de números inválidos em background.
 * Autenticada via x-cron-secret para impedir chamadas externas.
 * Chamada de forma fire-and-forget pelo POST /api/anti-spam/groups/remove-invalid.
 *
 * Remove devagar: delay de 2s entre cada remoção para não sobrecarregar a API.
 */

import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { fetchAllGroupsWithParticipants, removeParticipant } from '@/lib/anti-spam/evolution-client';
import { normalizeToE164BR } from '@/lib/utils/phone-utils';

export const runtime = 'nodejs';
export const maxDuration = 300;

const LOG_PREFIX = '[anti-spam/remove-invalid/process]';
const DELAY_BETWEEN_REMOVALS_MS = 2000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return errorResponse('Não autorizado', 401);
  }

  const body = await req.json().catch(() => ({}));
  const { job_id } = body;
  if (!job_id) return errorResponse('job_id é obrigatório', 400);

  // Busca job e valida
  const { data: job } = await supabaseServiceRole
    .from('anti_spam_remove_jobs')
    .select('id, config_id, owner_id, status')
    .eq('id', job_id)
    .single();

  if (!job) {
    console.error(LOG_PREFIX, 'job não encontrado', { job_id });
    return errorResponse('Job não encontrado', 404);
  }

  if (job.status !== 'pending') {
    console.warn(LOG_PREFIX, 'job já processado', { job_id, status: job.status });
    return errorResponse('Job já foi processado', 409);
  }

  await supabaseServiceRole
    .from('anti_spam_remove_jobs')
    .update({ status: 'running' })
    .eq('id', job_id);

  const startMs = Date.now();
  const configId = job.config_id;
  const userId = job.owner_id;

  try {
    const { data: config } = await supabaseServiceRole
      .from('anti_spam_configs')
      .select('id, master_instance_id, banca_id')
      .eq('id', configId)
      .single();

    if (!config) throw new Error('Configuração não encontrada');

    const { data: groupsRows } = await supabaseServiceRole
      .from('anti_spam_groups')
      .select('group_jid, group_name')
      .eq('config_id', configId)
      .eq('is_monitored', true);

    const groups = groupsRows ?? [];

    if (groups.length === 0) {
      await supabaseServiceRole
        .from('anti_spam_remove_jobs')
        .update({
          status: 'completed',
          result: { total: 0, removed: 0, failed: 0, errors: [], message: 'Nenhum grupo monitorado.' },
        })
        .eq('id', job_id);
      return successResponse({ ok: true });
    }

    const groupJids = [...new Set(groups.map((g) => g.group_jid))];
    const fetchResult = await fetchAllGroupsWithParticipants(config.master_instance_id, groupJids);

    if (!fetchResult.success || !fetchResult.groupMap) {
      throw new Error(fetchResult.error || 'Erro ao buscar grupos da instância');
    }

    // Monta lista de (phone_raw, group_jid) onde o número é inválido
    type RemovalTarget = { phone_raw: string; group_jid: string };
    const targets: RemovalTarget[] = [];

    for (const g of groups) {
      const participants = fetchResult.groupMap.get(g.group_jid);
      if (!participants) continue;

      for (const p of participants) {
        const digits = p.phone.replace(/\D/g, '');
        const e164 = normalizeToE164BR(digits);
        if (!e164) {
          // Número inválido — adiciona para remoção
          targets.push({ phone_raw: digits || p.phone, group_jid: g.group_jid });
        }
      }
    }

    console.log(LOG_PREFIX, 'iniciando remoção', { job_id, total: targets.length });

    const errors: { phone: string; group_jid: string; error: string }[] = [];
    let removed = 0;
    let failed = 0;

    for (let i = 0; i < targets.length; i++) {
      const { phone_raw, group_jid } = targets[i];

      const removeResult = await removeParticipant(config.master_instance_id, group_jid, phone_raw);

      if (removeResult.success) {
        removed++;
      } else {
        failed++;
        errors.push({ phone: phone_raw, group_jid, error: removeResult.error ?? 'Erro desconhecido' });
      }

      // Registra a ação no log
      await supabaseServiceRole.from('anti_spam_actions').insert({
        config_id: configId,
        banca_id: config.banca_id ?? null,
        user_id: userId,
        event_id: null,
        group_jid,
        phone_e164: null,
        action: 'remove_invalid_number',
        result: removeResult.success ? 'success' : 'fail',
        error_message: removeResult.error ?? null,
        meta: {
          source: 'remove_invalid_job',
          raw_jid: phone_raw,
          httpStatus: removeResult.httpStatus,
        },
      });

      // Delay entre remoções — exceto após a última
      if (i < targets.length - 1) {
        await sleep(DELAY_BETWEEN_REMOVALS_MS);
      }
    }

    const result = {
      total: targets.length,
      removed,
      failed,
      errors: errors.slice(0, 50), // limita para não estourar o JSONB
    };

    await supabaseServiceRole
      .from('anti_spam_remove_jobs')
      .update({ status: 'completed', result })
      .eq('id', job_id);

    console.log(LOG_PREFIX, 'concluído', {
      job_id,
      duration_ms: Date.now() - startMs,
      total: targets.length,
      removed,
      failed,
    });

    return successResponse({ ok: true });
  } catch (err: any) {
    console.error(LOG_PREFIX, 'erro', { job_id, message: err?.message, duration_ms: Date.now() - startMs });
    await supabaseServiceRole
      .from('anti_spam_remove_jobs')
      .update({ status: 'failed', error: err?.message || 'Erro desconhecido' })
      .eq('id', job_id);
    return errorResponse(err.message || 'Erro ao remover inválidos', 500);
  }
}
