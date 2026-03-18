/**
 * POST /api/anti-spam/groups/remove-invalid-single
 * Remove números inválidos de um único grupo de forma síncrona com delay entre remoções.
 * Uso: quando o usuário clica em "Remover inválidos" dentro de um grupo específico no scan.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { fetchAllGroupsWithParticipants, removeParticipant } from '@/lib/anti-spam/evolution-client';
import { normalizeToE164BR } from '@/lib/utils/phone-utils';

export const runtime = 'nodejs';
export const maxDuration = 120;

const LOG_PREFIX = '[anti-spam/remove-invalid-single]';
const DELAY_BETWEEN_REMOVALS_MS = 2000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json().catch(() => ({}));
    const configId = (body.config_id as string | undefined)?.trim();
    const groupJid = (body.group_jid as string | undefined)?.trim();

    if (!configId) return errorResponse('config_id é obrigatório', 400);
    if (!groupJid) return errorResponse('group_jid é obrigatório', 400);

    const { data: config, error: cfgErr } = await supabaseServiceRole
      .from('anti_spam_configs')
      .select('id, master_instance_id, banca_id')
      .eq('id', configId)
      .eq('owner_type', 'user')
      .eq('owner_id', userId)
      .single();

    if (cfgErr || !config) return errorResponse('Configuração não encontrada', 404);

    const fetchResult = await fetchAllGroupsWithParticipants(config.master_instance_id, [groupJid]);

    if (!fetchResult.success || !fetchResult.groupMap) {
      return errorResponse(fetchResult.error || 'Erro ao buscar participantes do grupo', 502);
    }

    const participants = fetchResult.groupMap.get(groupJid);
    if (!participants) {
      return errorResponse('Grupo não encontrado na instância', 404);
    }

    // Coleta apenas os números inválidos
    const invalids = participants
      .filter((p) => normalizeToE164BR(p.phone.replace(/\D/g, '')) === null)
      .map((p) => p.phone.replace(/\D/g, '') || p.phone);

    if (invalids.length === 0) {
      return successResponse({ total: 0, removed: 0, failed: 0 });
    }

    let removed = 0;
    let failed = 0;

    for (let i = 0; i < invalids.length; i++) {
      const phoneRaw = invalids[i];
      const result = await removeParticipant(config.master_instance_id, groupJid, phoneRaw);

      if (result.success) {
        removed++;
      } else {
        failed++;
      }

      await supabaseServiceRole.from('anti_spam_actions').insert({
        config_id: configId,
        banca_id: config.banca_id ?? null,
        user_id: userId,
        event_id: null,
        group_jid: groupJid,
        phone_e164: null,
        action: 'remove_invalid_number',
        result: result.success ? 'success' : 'fail',
        error_message: result.error ?? null,
        meta: { source: 'remove_invalid_single', raw_jid: phoneRaw, httpStatus: result.httpStatus },
      });

      if (i < invalids.length - 1) {
        await sleep(DELAY_BETWEEN_REMOVALS_MS);
      }
    }

    console.log(LOG_PREFIX, 'concluído', { configId, groupJid, total: invalids.length, removed, failed });

    return successResponse({ total: invalids.length, removed, failed });
  } catch (err: any) {
    console.error(LOG_PREFIX, 'erro', { message: err?.message });
    return errorResponse(err.message || 'Erro ao remover inválidos do grupo', 500);
  }
}
