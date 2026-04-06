/**
 * Scanner de grupos do WhatsApp.
 * Busca todos os grupos das configs ativas, escaneia em lotes de 5,
 * remove números da blacklist e internacionais, registra logs no banco.
 * Agendamento típico: a cada 20 minutos no deploy (ex.: Netlify) ou via POST /api/admin/anti-spam/scan-groups / /api/cron/anti-spam-group-scanner.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { normalizeToE164BR, toWaJid } from '@/lib/utils/phone-utils';
import { getGroupParticipants, removeParticipant } from './evolution-client';
import type { AntiSpamConfig } from './types';

const SCAN_BATCH_SIZE = 5;

/** Busca as mesmas configs ativas que o worker usa */
async function loadActiveConfigs(): Promise<AntiSpamConfig[]> {
  const { data: configs, error } = await supabaseServiceRole
    .from('anti_spam_configs')
    .select(`
      id,
      banca_id,
      owner_type,
      owner_id,
      is_enabled,
      master_instance_id,
      watcher_instance_id,
      denuncia_group_jid,
      scan_mode
    `)
    .eq('is_enabled', true);

  if (error || !configs?.length) return [];

  const instanceIds = new Set<string>();
  configs.forEach((c: any) => {
    if (c.master_instance_id) instanceIds.add(c.master_instance_id);
    if (c.watcher_instance_id) instanceIds.add(c.watcher_instance_id);
  });

  const { data: instances } = await supabaseServiceRole
    .from('evolution_instances')
    .select('id, instance_name')
    .in('id', Array.from(instanceIds));

  const nameById = new Map<string, string>();
  instances?.forEach((i: any) => nameById.set(i.id, i.instance_name));

  return configs.map((c: any) => ({
    ...c,
    owner_type: c.owner_type || 'banca',
    owner_id: c.owner_id || null,
    banca_id: c.banca_id || null,
    denuncia_group_jid: c.denuncia_group_jid || null,
    master_instance_name: nameById.get(c.master_instance_id),
    watcher_instance_name: c.watcher_instance_id ? nameById.get(c.watcher_instance_id) : null,
  }));
}

/** Cache de blacklist por config_id para não fazer N queries */
interface BlacklistCache {
  phones: Set<string>;
}
const blacklistCacheByConfig = new Map<string, BlacklistCache>();

async function getBlacklistCache(configId: string): Promise<BlacklistCache> {
  if (blacklistCacheByConfig.has(configId)) {
    return blacklistCacheByConfig.get(configId)!;
  }

  const { data, error } = await supabaseServiceRole
    .from('anti_spam_blacklist')
    .select('phone_e164')
    .eq('config_id', configId)
    .eq('status', 'active');

  const cache: BlacklistCache = { phones: new Set((data ?? []).map((r: { phone_e164: string }) => r.phone_e164)) };

  if (!error) blacklistCacheByConfig.set(configId, cache);
  return cache;
}

/** Busca grupos de uma config: se scan_mode=all_groups → fetchAllGroups, senão → anti_spam_groups */
async function getConfigGroups(
  config: AntiSpamConfig
): Promise<Array<{ groupJid: string; groupName: string }>> {
  if (config.scan_mode === 'all_groups' && config.master_instance_id) {
    // Usa fetchAllGroups V2 com groupJids vazio para pegar todos
    const { fetchAllGroupsWithParticipants } = await import('./evolution-client');
    const result = await fetchAllGroupsWithParticipants(config.master_instance_id);
    if (!result.success || !result.groupMap) return [];
    return Array.from(result.groupMap.keys()).map((gId) => ({
      groupJid: gId,
      groupName: gId,
    }));
  }

  // scan_mode = selected_groups → usa anti_spam_groups
  const { data } = await supabaseServiceRole
    .from('anti_spam_groups')
    .select('group_jid, group_name')
    .eq('config_id', config.id)
    .eq('is_monitored', true);

  if (!data?.length) return [];
  return data.map((g: any) => ({
    groupJid: g.group_jid,
    groupName: g.group_name || g.group_jid,
  }));
}

interface ScanResult {
  groupJid: string;
  groupName: string;
  participantsTotal: number;
  removed: Array<{ phone_e164: string; reason: 'blacklist' | 'invalid_number' }>;
  errors: string[];
}

/**
 * Escaneia um único grupo, encontrando e removendo números na blacklist ou inválidos.
 */
async function scanSingleGroup(
  config: AntiSpamConfig,
  groupJid: string,
  groupName: string,
  blacklist: BlacklistCache
): Promise<ScanResult> {
  const result: ScanResult = {
    groupJid,
    groupName,
    participantsTotal: 0,
    removed: [],
    errors: [],
  };

  const participantsResult = await getGroupParticipants(config.master_instance_id, groupJid);
  if (!participantsResult.success) {
    result.errors.push(participantsResult.error || 'Erro ao buscar participantes');
    return result;
  }

  const participants = participantsResult.participants ?? [];
  result.participantsTotal = participants.length;

  for (const p of participants) {
    const raw = p.phone || '';
    if (!raw) continue;

    const phoneE164 = normalizeToE164BR(raw);

    // 1) Número internacional / inválido (não é BR válido)
    if (!phoneE164) {
      const rawDigits = String(raw).replace(/\D/g, '');
      // Só tenta remover se parece ter um número (≥ 8 dígitos)
      if (rawDigits.length >= 8) {
        try {
          const removeResult = await removeParticipant(config.master_instance_id, groupJid, raw);
          result.removed.push({
            phone_e164: rawDigits.startsWith('55') ? '+' + rawDigits : '+' + '55' + rawDigits,
            reason: 'invalid_number',
          });
          await supabaseServiceRole.from('anti_spam_actions').insert({
            config_id: config.id,
            banca_id: config.banca_id,
            user_id: config.owner_type === 'user' ? config.owner_id : null,
            event_id: null,
            group_jid: groupJid,
            phone_e164: rawDigits.startsWith('55') ? '+' + rawDigits : '+' + '55' + rawDigits,
            action: 'scan_remove_invalid',
            result: removeResult.success ? 'success' : 'fail',
            error_message: removeResult.error ?? null,
            meta: { source: 'group_scanner', reason: 'invalid_number' },
          });
        } catch (err: any) {
          result.errors.push(`Erro ao remover inválido: ${err?.message || err}`);
        }
      }
      continue;
    }

    // 2) Número na blacklist
    if (blacklist.phones.has(phoneE164)) {
      try {
        const removeResult = await removeParticipant(config.master_instance_id, groupJid, phoneE164);
        result.removed.push({ phone_e164: phoneE164, reason: 'blacklist' });
        await supabaseServiceRole.from('anti_spam_actions').insert({
          config_id: config.id,
          banca_id: config.banca_id,
          user_id: config.owner_type === 'user' ? config.owner_id : null,
          event_id: null,
          group_jid: groupJid,
          phone_e164: phoneE164,
          action: 'scan_remove_blacklist',
          result: removeResult.success ? 'success' : 'fail',
          error_message: removeResult.error ?? null,
          meta: { source: 'group_scanner', reason: 'blacklist' },
        });
      } catch (err: any) {
        result.errors.push(`Erro ao remover blacklist: ${err?.message || err}`);
      }
    }
  }

  return result;
}

/**
 * Salva um log de scan batch no banco (anti_spam_scan_jobs ou ação direta).
 * Para simplicidade, usa anti_spam_actions com meta.source = 'group_scanner_batch'.
 */
async function logBatchToDB(
  configId: string,
  bancaId: string | null,
  userId: string | null,
  batchResults: ScanResult[],
  batchStartIndex: number,
  batchTotal: number
): Promise<void> {
  const totalRemoved = batchResults.reduce((s, r) => s + r.removed.length, 0);
  const totalErrors = batchResults.reduce((s, r) => s + r.errors.length, 0);

  await supabaseServiceRole.from('anti_spam_scan_jobs').insert({
    config_id: configId,
    owner_id: userId || bancaId,
    status: totalErrors > 0 ? 'partial' : 'completed',
    result: {
      batch_range: `${batchStartIndex}-${batchStartIndex + batchTotal - 1}`,
      total_groups: batchTotal,
      total_removed: totalRemoved,
      total_errors: totalErrors,
      groups: batchResults.map((r) => ({
        group_jid: r.groupJid,
        group_name: r.groupName,
        participants_total: r.participantsTotal,
        removed: r.removed,
        errors: r.errors,
      })),
    },
    error: totalErrors > 0 ? batchResults.flatMap((r) => r.errors).join(' | ') : null,
  });
}

/**
 * Registra um job de scan completo ao final.
 */
async function logFullScanComplete(
  configId: string,
  bancaId: string | null,
  userId: string | null,
  totalGroupsScanned: number,
  totalRemoved: number,
  totalRemovedBlacklist: number,
  totalRemovedInvalid: number,
  totalErrors: number
): Promise<void> {
  await supabaseServiceRole.from('anti_spam_scan_jobs').insert({
    config_id: configId,
    owner_id: userId || bancaId,
    status: totalErrors > 0 ? 'partial' : 'completed',
    result: {
      total_groups_scanned: totalGroupsScanned,
      total_removed: totalRemoved,
      total_removed_blacklist: totalRemovedBlacklist,
      total_removed_invalid: totalRemovedInvalid,
      total_errors: totalErrors,
    },
    error: null,
  });
}

/**
 * Scanner principal: para cada config ativa, busca grupos, processa em lotes de 5,
 * salva logs de cada batch e retorna resultados incrementais.
 */
export async function runGroupScanner(): Promise<Array<{
  config_id: string;
  banca_id: string | null;
  owner_id: string | null;
  total_groups: number;
  total_removed: number;
  total_errors: number;
  batches: ScanResult[][];
}>> {
  const configs = await loadActiveConfigs();
  if (configs.length === 0) return [];

  const globalResults: Array<{
    config_id: string;
    banca_id: string | null;
    owner_id: string | null;
    total_groups: number;
    total_removed: number;
    total_errors: number;
    batches: ScanResult[][];
  }> = [];

  for (const config of configs) {
    const groups = await getConfigGroups(config);
    if (groups.length === 0) continue;

    const blacklist = await getBlacklistCache(config.id);

    console.log(`[GroupScanner] Config ${config.id}: ${groups.length} grupos para escanear, ${blacklist.phones.size} na blacklist`);

    const batches: ScanResult[][] = [];
    let totalRemoved = 0;
    let totalErrors = 0;

    // Processa em lotes de 5
    for (let i = 0; i < groups.length; i += SCAN_BATCH_SIZE) {
      const batch = groups.slice(i, i + SCAN_BATCH_SIZE);
      const batchResults: ScanResult[] = [];

      for (const g of batch) {
        const scanResult = await scanSingleGroup(config, g.groupJid, g.groupName, blacklist);
        batchResults.push(scanResult);
        totalRemoved += scanResult.removed.length;
        totalErrors += scanResult.errors.length;
      }

      // Salva batch no banco imediatamente (progress streaming)
      await logBatchToDB(
        config.id,
        config.banca_id,
        config.owner_type === 'user' ? config.owner_id : null,
        batchResults,
        i + 1,
        batchResults.length
      );

      batches.push(batchResults);
      console.log(`[GroupScanner] Batch ${Math.floor(i / SCAN_BATCH_SIZE) + 1}: ${batchResults.length} grupos, ${batchResults.reduce((s, r) => s + r.removed.length, 0)} removidos`);
    }

    globalResults.push({
      config_id: config.id,
      banca_id: config.banca_id,
      owner_id: config.owner_id,
      total_groups: groups.length,
      total_removed: totalRemoved,
      total_errors: totalErrors,
      batches,
    });

    // Registra job completo
    const allBatchResults = batches.flat();
    const totalBlacklist = allBatchResults.flatMap((r) => r.removed.filter((x) => x.reason === 'blacklist')).length;
    const totalInvalid = allBatchResults.flatMap((r) => r.removed.filter((x) => x.reason === 'invalid_number')).length;

    await logFullScanComplete(
      config.id,
      config.banca_id,
      config.owner_type === 'user' ? config.owner_id : null,
      groups.length,
      totalRemoved,
      totalBlacklist,
      totalInvalid,
      totalErrors
    );
  }

  // Limpa cache de blacklist pós-scan
  blacklistCacheByConfig.clear();

  return globalResults;
}
