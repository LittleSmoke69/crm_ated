/**
 * POST /api/anti-spam/verify-groups
 * Verifica em quantos grupos cada número da blacklist aparece e remove (um por request).
 * Config deve ser owner_type=user, owner_id=userId.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { fetchAllGroupsWithParticipants, removeParticipant } from '@/lib/anti-spam/evolution-client';
import { normalizeToE164BR } from '@/lib/utils/phone-utils';

export const runtime = 'nodejs';
export const maxDuration = 120;

function jidToE164(jid: string): string | null {
  if (!jid || typeof jid !== 'string') return null;
  const digits = jid.replace(/@.*$/, '').replace(/\D/g, '');
  if (!digits) return null;
  return normalizeToE164BR(digits);
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json().catch(() => ({}));
    const configId = (body.config_id ?? req.nextUrl.searchParams.get('config_id'))?.trim();
    // include_invalid: também remove números inválidos/não-brasileiros (padrão: true)
    const includeInvalid: boolean = body.include_invalid !== false;
    if (!configId) return errorResponse('config_id é obrigatório', 400);

    const { data: config, error: configError } = await supabaseServiceRole
      .from('anti_spam_configs')
      .select('id, master_instance_id, banca_id, owner_type, owner_id')
      .eq('id', configId)
      .eq('owner_type', 'user')
      .eq('owner_id', userId)
      .single();

    if (configError || !config) {
      return errorResponse('Configuração não encontrada', 404);
    }

    const masterInstanceId = config.master_instance_id;
    const bancaId = config.banca_id ?? null;

    const { data: blacklistRows } = await supabaseServiceRole
      .from('anti_spam_blacklist')
      .select('phone_e164')
      .eq('config_id', configId)
      .eq('status', 'active');

    const blacklistSet = new Set((blacklistRows ?? []).map((r: { phone_e164: string }) => r.phone_e164));

    const { data: groupsRows } = await supabaseServiceRole
      .from('anti_spam_groups')
      .select('group_jid, group_name')
      .eq('config_id', configId)
      .eq('is_monitored', true);

    const groups = groupsRows ?? [];
    if (groups.length === 0) {
      return successResponse({
        report: [],
        removals: [],
        summary: { totalInGroups: 0, totalRemovals: 0, success: 0, failed: 0 },
        message: 'Nenhum grupo monitorado. Adicione grupos na aba Grupos protegidos.',
      });
    }

    // Evolution API V2: participantes via GET /group/participants por grupo
    const groupJids = groups.map((g) => g.group_jid);
    const fetchResult = await fetchAllGroupsWithParticipants(masterInstanceId, groupJids);

    // phone_e164 → groups onde está presente (blacklist)
    const phoneToGroups: Record<string, string[]> = {};
    // jid → groups onde está presente (número inválido)
    const invalidJidToGroups: Record<string, string[]> = {};
    const groupErrors: { groupJid: string; error: string }[] = [];

    if (!fetchResult.success || !fetchResult.groupMap) {
      return errorResponse(fetchResult.error || 'Erro ao buscar grupos da instância', 502);
    }

    for (const g of groups) {
      const groupJid = g.group_jid;
      const participants = fetchResult.groupMap.get(groupJid);
      if (!participants) {
        groupErrors.push({ groupJid, error: 'Grupo não encontrado na instância' });
        continue;
      }
      for (const p of participants) {
        const e164 = normalizeToE164BR(p.phone);
        if (!e164) {
          if (includeInvalid) {
            if (!invalidJidToGroups[p.phone]) invalidJidToGroups[p.phone] = [];
            if (!invalidJidToGroups[p.phone].includes(groupJid)) invalidJidToGroups[p.phone].push(groupJid);
          }
          continue;
        }
        if (!blacklistSet.has(e164)) continue;
        if (!phoneToGroups[e164]) phoneToGroups[e164] = [];
        if (!phoneToGroups[e164].includes(groupJid)) phoneToGroups[e164].push(groupJid);
      }
    }

    const report = Object.entries(phoneToGroups).map(([phone_e164, groupJids]) => ({
      phone_e164,
      groups_count: groupJids.length,
      group_jids: groupJids,
      reason: 'blacklist' as const,
    }));

    const invalidReport = Object.entries(invalidJidToGroups).map(([jid, groupJids]) => ({
      phone_e164: jid,
      groups_count: groupJids.length,
      group_jids: groupJids,
      reason: 'invalid_number' as const,
    }));

    const allReport = [...report, ...invalidReport];

    const removals: { phone_e164: string; group_jid: string; success: boolean; error?: string; reason: string }[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const entry of allReport) {
      for (const groupJid of entry.group_jids) {
        const removeResult = await removeParticipant(masterInstanceId, groupJid, entry.phone_e164);
        const ok = removeResult.success;
        if (ok) successCount++;
        else failCount++;
        removals.push({
          phone_e164: entry.phone_e164,
          group_jid: groupJid,
          success: ok,
          error: removeResult.error ?? undefined,
          reason: entry.reason,
        });

        await supabaseServiceRole.from('anti_spam_actions').insert({
          config_id: configId,
          banca_id: bancaId,
          user_id: userId,
          event_id: null,
          group_jid: groupJid,
          phone_e164: entry.reason === 'blacklist' ? entry.phone_e164 : null,
          action: entry.reason === 'blacklist' ? 'remove_from_group' : 'remove_invalid_number',
          result: ok ? 'success' : 'fail',
          error_message: removeResult.error ?? null,
          meta: {
            source: 'verify_groups',
            reason: entry.reason,
            raw_jid: entry.reason === 'invalid_number' ? entry.phone_e164 : undefined,
            httpStatus: removeResult.httpStatus,
          },
        });
      }
    }

    return successResponse({
      report: allReport,
      removals,
      groupErrors: groupErrors.length ? groupErrors : undefined,
      summary: {
        totalInGroups: allReport.reduce((s, r) => s + r.groups_count, 0),
        totalRemovals: removals.length,
        success: successCount,
        failed: failCount,
        invalid_removed: removals.filter((r) => r.reason === 'invalid_number' && r.success).length,
        blacklisted_removed: removals.filter((r) => r.reason === 'blacklist' && r.success).length,
      },
    });
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao verificar grupos', 401);
  }
}
