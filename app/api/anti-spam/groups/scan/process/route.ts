/**
 * POST /api/anti-spam/groups/scan/process
 * Rota interna: executa o scan de grupos em background.
 * Autenticada via x-cron-secret para impedir chamadas externas.
 * Chamada de forma fire-and-forget pelo POST /api/anti-spam/groups/scan.
 */

import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { fetchAllGroupsWithParticipants, getInstanceCredentials } from '@/lib/anti-spam/evolution-client';
import { normalizeToE164BR } from '@/lib/utils/phone-utils';

export const runtime = 'nodejs';
export const maxDuration = 300;

const LOG_PREFIX = '[anti-spam/scan/process]';

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
    .from('anti_spam_scan_jobs')
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
    .from('anti_spam_scan_jobs')
    .update({ status: 'running' })
    .eq('id', job_id);

  const startMs = Date.now();
  const configId = job.config_id;

  try {
    const { data: config } = await supabaseServiceRole
      .from('anti_spam_configs')
      .select('id, master_instance_id')
      .eq('id', configId)
      .single();

    if (!config) throw new Error('Configuração não encontrada');

    const creds = await getInstanceCredentials(config.master_instance_id);
    if (!creds) throw new Error('Instância não encontrada ou sem credenciais');

    const { data: groupsRows } = await supabaseServiceRole
      .from('anti_spam_groups')
      .select('group_jid, group_name')
      .eq('config_id', configId)
      .eq('is_monitored', true);

    const groups = groupsRows ?? [];

    if (groups.length === 0) {
      await supabaseServiceRole
        .from('anti_spam_scan_jobs')
        .update({
          status: 'completed',
          result: {
            instance: { id: config.master_instance_id, name: creds.instanceName },
            groups: [],
            summary: { groups_scanned: 0, total_participants: 0, invalid_total: 0, blacklisted_total: 0 },
            message: 'Nenhum grupo monitorado.',
          },
        })
        .eq('id', job_id);
      return successResponse({ ok: true });
    }

    const { data: blRows } = await supabaseServiceRole
      .from('anti_spam_blacklist')
      .select('phone_e164')
      .eq('config_id', configId)
      .eq('status', 'active');

    const blacklistSet = new Set((blRows ?? []).map((r: { phone_e164: string }) => r.phone_e164));

    const groupJids = [...new Set(groups.map((g) => g.group_jid))];
    const fetchResult = await fetchAllGroupsWithParticipants(config.master_instance_id, groupJids);

    type ContactRow = { phone: string; name: string | null; is_valid_br: boolean; is_blacklisted: boolean };
    type GroupScan = {
      group_jid: string;
      group_name: string | null;
      fetch_error?: string;
      participants_total: number;
      invalid_count: number;
      blacklisted_count: number;
      contacts: ContactRow[];
    };

    const groupScans: GroupScan[] = [];
    let totalParticipants = 0;
    let invalidTotal = 0;
    let blacklistedTotal = 0;

    for (const g of groups) {
      if (!fetchResult.success || !fetchResult.groupMap) {
        groupScans.push({
          group_jid: g.group_jid,
          group_name: g.group_name ?? null,
          fetch_error: fetchResult.error || 'Erro ao buscar grupos da instância',
          participants_total: 0, invalid_count: 0, blacklisted_count: 0, contacts: [],
        });
        continue;
      }

      const participantJidsRaw = fetchResult.groupMap.get(g.group_jid) ?? null;
      if (participantJidsRaw === null) {
        const fetchError = fetchResult.errorMap?.get(g.group_jid) ?? 'Grupo não encontrado na instância';
        groupScans.push({
          group_jid: g.group_jid,
          group_name: g.group_name ?? null,
          fetch_error: fetchError,
          participants_total: 0, invalid_count: 0, blacklisted_count: 0, contacts: [],
        });
        continue;
      }

      const participants = [...participantJidsRaw];
      const contacts: ContactRow[] = [];
      let invalidCount = 0;
      let blacklistedCount = 0;

      for (const p of participants) {
        // phone já vem limpo (somente dígitos) do evolution-client
        const digits = p.phone.replace(/\D/g, '');
        const e164 = normalizeToE164BR(digits);
        const isValidBr = e164 !== null;
        const isBlacklisted = e164 ? blacklistSet.has(e164) : false;

        contacts.push({ phone: digits || p.phone, name: p.name ?? null, is_valid_br: isValidBr, is_blacklisted: isBlacklisted });
        if (!isValidBr) invalidCount++;
        if (isBlacklisted) blacklistedCount++;
      }

      totalParticipants += contacts.length;
      invalidTotal += invalidCount;
      blacklistedTotal += blacklistedCount;

      groupScans.push({
        group_jid: g.group_jid,
        group_name: g.group_name ?? null,
        participants_total: contacts.length,
        invalid_count: invalidCount,
        blacklisted_count: blacklistedCount,
        contacts,
      });
    }

    const result = {
      instance: { id: config.master_instance_id, name: creds.instanceName },
      groups: groupScans,
      summary: {
        groups_scanned: groupScans.length,
        total_participants: totalParticipants,
        invalid_total: invalidTotal,
        blacklisted_total: blacklistedTotal,
      },
    };

    await supabaseServiceRole
      .from('anti_spam_scan_jobs')
      .update({ status: 'completed', result })
      .eq('id', job_id);

    console.log(LOG_PREFIX, 'concluído', {
      job_id,
      duration_ms: Date.now() - startMs,
      groups_scanned: groupScans.length,
      total_participants: totalParticipants,
    });

    return successResponse({ ok: true });
  } catch (err: any) {
    console.error(LOG_PREFIX, 'erro', { job_id, message: err?.message, duration_ms: Date.now() - startMs });
    await supabaseServiceRole
      .from('anti_spam_scan_jobs')
      .update({ status: 'failed', error: err?.message || 'Erro desconhecido' })
      .eq('id', job_id);
    return errorResponse(err.message || 'Erro ao processar scan', 500);
  }
}
