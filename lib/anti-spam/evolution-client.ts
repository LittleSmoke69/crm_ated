/**
 * Cliente Evolution API para o módulo Anti-Spam.
 * Remove participante do grupo e (opcional) deleta mensagem.
 * Rate limit: 1 ação/segundo por instância. Retry: 3 tentativas com backoff.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { toWaJid } from '@/lib/utils/phone-utils';

const FETCH_TIMEOUT_MS = 25_000;
const RATE_LIMIT_MS = 1000; // 1 por segundo por instância
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 500;

/** Último uso por instance_id para rate limit */
const lastCallByInstance = new Map<string, number>();

function normalizeBaseUrl(baseUrl: string): string {
  if (!baseUrl) return '';
  return baseUrl.replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
}

export interface InstanceCredentials {
  instanceName: string;
  baseUrl: string;
  apikey: string;
}

/**
 * Resolve baseUrl e apikey a partir de evolution_instances + evolution_apis.
 */
export async function getInstanceCredentials(instanceId: string): Promise<InstanceCredentials | null> {
  const { data: instance, error } = await supabaseServiceRole
    .from('evolution_instances')
    .select(`
      id,
      instance_name,
      apikey,
      evolution_apis!inner (
        id,
        base_url,
        api_key_global
      )
    `)
    .eq('id', instanceId)
    .single();

  if (error || !instance) return null;

  const api = Array.isArray(instance.evolution_apis) ? instance.evolution_apis[0] : instance.evolution_apis;
  const baseUrl = api?.base_url;
  const apikey = instance.apikey || api?.api_key_global;
  if (!baseUrl || !apikey) return null;

  return {
    instanceName: instance.instance_name,
    baseUrl,
    apikey,
  };
}

function waitRateLimit(instanceId: string): Promise<void> {
  const last = lastCallByInstance.get(instanceId) ?? 0;
  const now = Date.now();
  const elapsed = now - last;
  if (elapsed >= RATE_LIMIT_MS) {
    lastCallByInstance.set(instanceId, now);
    return Promise.resolve();
  }
  const wait = RATE_LIMIT_MS - elapsed;
  lastCallByInstance.set(instanceId, now + wait);
  return new Promise((r) => setTimeout(r, wait));
}

export interface RemoveParticipantResult {
  success: boolean;
  error?: string;
  httpStatus?: number;
}

/**
 * Remove participante do grupo via Evolution API.
 * participantJidOrPhone: JID (5531999887766@s.whatsapp.net) ou número (31999887766).
 */
export async function removeParticipant(
  instanceId: string,
  groupJid: string,
  participantJidOrPhone: string
): Promise<RemoveParticipantResult> {
  const creds = await getInstanceCredentials(instanceId);
  if (!creds) {
    return { success: false, error: 'Instância não encontrada ou sem credenciais' };
  }

  await waitRateLimit(instanceId);

  const participantJid = participantJidOrPhone.includes('@')
    ? participantJidOrPhone
    : toWaJid(participantJidOrPhone);

  const baseUrl = normalizeBaseUrl(creds.baseUrl);
  const url = `${baseUrl}/group/updateParticipant/${creds.instanceName}?groupJid=${encodeURIComponent(groupJid)}`;
  const finalUrl = url.replace(/([^:]\/)\/+/g, '$1');

  const body = { action: 'remove', participants: [participantJid] };

  let lastError: string | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const response = await fetch(finalUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: creds.apikey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const text = await response.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }

      if (response.ok) {
        return { success: true, httpStatus: response.status };
      }

      lastError = data?.message || data?.error || `HTTP ${response.status}`;
      if (attempt < MAX_RETRIES) {
        const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoff));
      } else {
        return { success: false, error: lastError, httpStatus: response.status };
      }
    } catch (err: any) {
      lastError = err?.message || String(err);
      if (attempt < MAX_RETRIES) {
        const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoff));
      } else {
        return { success: false, error: lastError };
      }
    }
  }

  return { success: false, error: lastError || 'Unknown error' };
}

export interface DeleteMessageKey {
  remoteJid: string;
  id: string;
  fromMe: boolean;
}

export interface DeleteMessageResult {
  success: boolean;
  error?: string;
  httpStatus?: number;
}

/**
 * Deleta mensagem para todos (opcional).
 * key: { remoteJid, id, fromMe } do payload da mensagem.
 */
export async function deleteMessageForEveryone(
  instanceId: string,
  key: DeleteMessageKey
): Promise<DeleteMessageResult> {
  const creds = await getInstanceCredentials(instanceId);
  if (!creds) {
    return { success: false, error: 'Instância não encontrada ou sem credenciais' };
  }

  await waitRateLimit(instanceId);

  const baseUrl = normalizeBaseUrl(creds.baseUrl);
  // Endpoint comum em Evolution API v1/v2
  const url = `${baseUrl}/chat/sendMessage/${creds.instanceName}`;
  const finalUrl = url.replace(/([^:]\/)\/+/g, '$1');

  // Payload para "delete message for everyone" (varia por versão da API)
  const body = {
    deleteMessage: {
      remoteJid: key.remoteJid,
      id: key.id,
      fromMe: key.fromMe,
    },
  };

  let lastError: string | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const response = await fetch(finalUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: creds.apikey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const text = await response.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }

      if (response.ok) {
        return { success: true, httpStatus: response.status };
      }

      lastError = data?.message || data?.error || `HTTP ${response.status}`;
      if (attempt < MAX_RETRIES) {
        const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoff));
      } else {
        return { success: false, error: lastError, httpStatus: response.status };
      }
    } catch (err: any) {
      lastError = err?.message || String(err);
      if (attempt < MAX_RETRIES) {
        const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, backoff));
      } else {
        return { success: false, error: lastError };
      }
    }
  }

  return { success: false, error: lastError || 'Unknown error' };
}
