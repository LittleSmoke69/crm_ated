/**
 * POST /api/admin/anti-spam/verify-groups
 * Verifica em quantos grupos cada número da blacklist aparece e remove um número por request.
 * Usa Evolution: GET group/participants e POST group/updateParticipant (action: remove).
 * RBAC: super_admin, admin, auditoria
 */

import { NextRequest } from 'next/server';
import { requireAntiSpamAccess } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getGroupParticipants, removeParticipant } from '@/lib/anti-spam/evolution-client';
import { normalizeToE164BR } from '@/lib/utils/phone-utils';

export const runtime = 'nodejs';
export const maxDuration = 120;

function jidToE164(jid: string): string | null {
  if (!jid || typeof jid !== 'string') return null;
  const digits = jid.replace(/@.*$/, '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const e164 = normalizeToE164BR(digits.startsWith('55') ? digits : '55' + digits);
  return e164 ?? (digits.length >= 12 ? '+' + digits : null);
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAntiSpamAccess(req);
    const body = await req.json().catch(() => ({}));
    const configId = (body.config_id ?? req.nextUrl.searchParams.get('config_id'))?.trim();
    if (!configId) return errorResponse('config_id é obrigatório', 400);

    const { data: config, error: configError } = await supabaseServiceRole
      .from('anti_spam_configs')
      .select('id, master_instance_id, banca_id, owner_type, owner_id')
      .eq('id', configId)
      .single();

    if (configError || !config) {
      return errorResponse('Configuração não encontrada', 404);
    }

    const masterInstanceId = config.master_instance_id;
    const bancaId = config.banca_id ?? null;
    const ownerUserId = config.owner_type === 'user' ? config.owner_id : null;

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

    const phoneToGroups: Record<string, string[]> = {};
    const groupErrors: { groupJid: string; error: string }[] = [];

    for (const g of groups) {
      const groupJid = g.group_jid;
      const result = await getGroupParticipants(masterInstanceId, groupJid);
      if (!result.success || !result.participants?.length) {
        if (!result.success) {
          groupErrors.push({ groupJid, error: result.error || 'Erro ao buscar participantes' });
        }
        continue;
      }
      for (const p of result.participants) {
        const e164 = jidToE164(p.phone);
        if (!e164 || !blacklistSet.has(e164)) continue;
        if (!phoneToGroups[e164]) phoneToGroups[e164] = [];
        if (!phoneToGroups[e164].includes(groupJid)) {
          phoneToGroups[e164].push(groupJid);
        }
      }
    }

    const report = Object.entries(phoneToGroups).map(([phone_e164, groupJids]) => ({
      phone_e164,
      groups_count: groupJids.length,
      group_jids: groupJids,
    }));

    const removals: { phone_e164: string; group_jid: string; success: boolean; error?: string }[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const entry of report) {
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
        });

        await supabaseServiceRole.from('anti_spam_actions').insert({
          config_id: configId,
          banca_id: bancaId,
          user_id: ownerUserId ?? userId,
          event_id: null,
          group_jid: groupJid,
          phone_e164: entry.phone_e164,
          action: 'remove_from_group',
          result: ok ? 'success' : 'fail',
          error_message: removeResult.error ?? null,
          meta: { source: 'verify_groups', httpStatus: removeResult.httpStatus },
        });
      }
    }

    return successResponse({
      report,
      removals,
      groupErrors: groupErrors.length ? groupErrors : undefined,
      summary: {
        totalInGroups: report.reduce((s, r) => s + r.groups_count, 0),
        totalRemovals: removals.length,
        success: successCount,
        failed: failCount,
      },
    });
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao verificar grupos', 401);
  }
}
