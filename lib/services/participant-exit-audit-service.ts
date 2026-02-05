/**
 * Serviço de Auditoria de Saídas de Participantes (group-participants.update action: remove)
 * Registra, organiza e disponibiliza dados de saída/remoção em grupos WhatsApp.
 * Hierarquia: Banca → Grupo → Evento → Usuário
 */

import { supabaseServiceRole } from './supabase-service';

const EVENT_TYPE = 'group-participants.update';
const ACTION_REMOVE = 'remove';

function getValueFromPath(obj: any, path: string): any {
  if (!obj) return undefined;
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let current = obj;
  for (const part of parts) {
    current = current?.[part];
    if (current === undefined) return undefined;
  }
  return current;
}

/**
 * Normaliza phoneNumber: remove @s.whatsapp.net e caracteres não numéricos
 */
function normalizePhone(value: string | undefined): string {
  if (value == null || value === '') return '';
  return String(value)
    .replace(/@s\.whatsapp\.net/i, '')
    .replace(/@c\.us/i, '')
    .replace(/@g\.us/i, '')
    .replace(/@lid/i, '')
    .replace(/\D/g, '')
    .trim();
}

/**
 * Resolve banca_id a partir do dono da instância (profile.banca_url -> crm_bancas.url)
 */
async function resolveBancaIdFromInstance(instanceId: string): Promise<string | null> {
  const { data: instance } = await supabaseServiceRole
    .from('evolution_instances')
    .select('user_id')
    .eq('id', instanceId)
    .single();

  const userId = instance?.user_id;
  if (!userId) return null;

  const { data: profile } = await supabaseServiceRole
    .from('profiles')
    .select('banca_url')
    .eq('id', userId)
    .single();

  const bancaUrl = profile?.banca_url;
  if (!bancaUrl) return null;

  const normalized = bancaUrl.trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/api\/crm\/?/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();

  const { data: bancas } = await supabaseServiceRole
    .from('crm_bancas')
    .select('id, url')
    .limit(100);

  const match = (bancas || []).find((b: { url?: string }) => {
    const u = (b.url || '').trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/api\/crm\/?/i, '')
      .replace(/\/+$/, '')
      .toLowerCase();
    return u === normalized || u.endsWith(normalized) || normalized.endsWith(u);
  });

  return match?.id ?? null;
}

export interface ParsedExitPayload {
  group_id: string;
  phone: string;
  action: string;
  event_type: string;
  author: string | null;
  occurred_at: string;
}

/**
 * Extrai dados do payload para evento group-participants.update action: remove
 */
export function parseExitPayload(payload: any): ParsedExitPayload | null {
  const eventType =
    payload?.event ||
    payload?.type ||
    payload?.data?.event ||
    '';
  if (eventType !== EVENT_TYPE) return null;

  const action =
    getValueFromPath(payload, 'data.action') ||
    getValueFromPath(payload, 'action') ||
    '';
  if (action !== ACTION_REMOVE) return null;

  const groupId =
    getValueFromPath(payload, 'data.id') ||
    getValueFromPath(payload, 'data.key.remoteJid') ||
    getValueFromPath(payload, 'data.groupJid') ||
    '';
  if (!groupId || typeof groupId !== 'string') return null;

  const rawPhone =
    getValueFromPath(payload, 'data.participants[0].phoneNumber') ||
    getValueFromPath(payload, 'data.participants[0].id') ||
    getValueFromPath(payload, 'data.participants.0.phoneNumber') ||
    getValueFromPath(payload, 'data.participants.0.id') ||
    getValueFromPath(payload, 'participants[0].phoneNumber') ||
    getValueFromPath(payload, 'participants[0].id') ||
    '';
  const phone = normalizePhone(rawPhone);
  if (!phone) return null;

  const author =
    getValueFromPath(payload, 'data.author') ||
    getValueFromPath(payload, 'data.by') ||
    getValueFromPath(payload, 'author') ||
    null;
  const occurredAt =
    payload?.received_at ||
    getValueFromPath(payload, 'data.timestamp') ||
    new Date().toISOString();

  return {
    group_id: String(groupId),
    phone,
    action: ACTION_REMOVE,
    event_type: EVENT_TYPE,
    author: author != null ? String(author) : null,
    occurred_at: typeof occurredAt === 'number' ? new Date(occurredAt * 1000).toISOString() : String(occurredAt),
  };
}

/**
 * Obtém evolution_instance_id pelo instance_name
 */
async function getInstanceIdByInstanceName(instanceName: string | null): Promise<string | null> {
  if (!instanceName) return null;
  const { data } = await supabaseServiceRole
    .from('evolution_instances')
    .select('id')
    .eq('instance_name', instanceName)
    .limit(1)
    .single();
  return data?.id ?? null;
}

/**
 * Registra uma saída na tabela de auditoria (apenas para action === 'remove')
 * Não interfere na operação principal; falhas são logadas e não propagadas.
 */
export async function recordParticipantExit(
  payload: any,
  instanceName: string | null
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const parsed = parseExitPayload(payload);
  if (!parsed) return { ok: false, error: 'not_remove_or_invalid' };

  const instanceId = await getInstanceIdByInstanceName(instanceName);
  if (!instanceId) {
    console.warn('[ParticipantExitAudit] instance_name não encontrado:', instanceName);
    return { ok: false, error: 'instance_not_found' };
  }

  const banca_id = await resolveBancaIdFromInstance(instanceId);

  const row = {
    evolution_instance_id: instanceId,
    banca_id: banca_id || undefined,
    group_id: parsed.group_id,
    phone: parsed.phone,
    action: parsed.action,
    event_type: parsed.event_type,
    author: parsed.author || undefined,
    occurred_at: parsed.occurred_at,
    payload: payload || undefined,
  };

  const { data, error } = await supabaseServiceRole
    .from('group_participant_exits')
    .insert(row)
    .select('id')
    .single();

  if (error) {
    console.error('[ParticipantExitAudit] Erro ao inserir:', error.message, row);
    return { ok: false, error: error.message };
  }

  return { ok: true, id: data?.id };
}

export const participantExitAuditService = {
  parseExitPayload,
  recordParticipantExit,
  resolveBancaIdFromInstance,
  EVENT_TYPE,
  ACTION_REMOVE,
};
