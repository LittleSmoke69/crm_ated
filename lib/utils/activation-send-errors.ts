/**
 * Mensagens de erro de disparo de ativação: evita persistir HTML de nginx/502 na UI e no banco.
 */

import { messageIndicatesEvolutionSessionDropped } from '@/lib/evolution/mark-instance-disconnected';

const MAX_LEN = 500;

/**
 * Converte payloads de erro da Evolution (string | objeto | array aninhado) em texto para DB/UI.
 * Evita `[object Object]` quando `j.error` ou `j.message` vêm como objeto JSON.
 */
export function stringifyMassSendUnknownError(value: unknown, maxLen = 2000): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return '';
    return maxLen > 0 && t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).slice(0, maxLen);
  }
  if (value instanceof Error) {
    const m = value.message?.trim() || '';
    const out = m || 'Error';
    return maxLen > 0 && out.length > maxLen ? `${out.slice(0, maxLen)}…` : out;
  }
  if (Array.isArray(value)) {
    const cap = Math.min(800, maxLen);
    const parts = value
      .map((x) => stringifyMassSendUnknownError(x, cap))
      .filter((p) => p.length > 0);
    const joined = parts.join('; ');
    return maxLen > 0 && joined.length > maxLen ? `${joined.slice(0, maxLen)}…` : joined;
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message.trim()) {
      return stringifyMassSendUnknownError(o.message, maxLen);
    }
    if (typeof o.error === 'string' && o.error.trim()) {
      return stringifyMassSendUnknownError(o.error, maxLen);
    }
    if (o.error != null && typeof o.error === 'object') {
      const nested = stringifyMassSendUnknownError(o.error, maxLen);
      if (nested) return nested;
    }
    const resp = o.response;
    if (resp != null && typeof resp === 'object') {
      const rm = (resp as Record<string, unknown>).message;
      if (rm != null) {
        const fromResp = stringifyMassSendUnknownError(rm, maxLen);
        if (fromResp) return fromResp;
      }
    }
    try {
      const s = JSON.stringify(value);
      const out = maxLen > 0 && s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
      return out;
    } catch {
      return '[erro não serializável]';
    }
  }
  return String(value).slice(0, maxLen);
}

/** Texto único para UI (disparo em massa, ativações, detalhe do job) quando a sessão Evolution cai. */
export const MASS_SEND_INSTANCE_DISCONNECTED_USER_MESSAGE =
  'A instância caiu ou foi desconectada. Reconecte o WhatsApp em Instâncias (QR) e tente o disparo novamente.';

export function massSendInstanceDisconnectedMessage(instanceName?: string | null): string {
  const n = instanceName?.trim();
  if (n) {
    return `A instância «${n}» caiu ou foi desconectada. Reconecte o WhatsApp em Instâncias (QR) e tente novamente.`;
  }
  return MASS_SEND_INSTANCE_DISCONNECTED_USER_MESSAGE;
}

/**
 * Erros em que a sessão WhatsApp/Evolution caiu: a campanha em massa deve parar (pausar),
 * não seguir tentando os demais grupos na mesma instância.
 */
export function isMassSendFatalInstanceDroppedError(error: string | null | undefined): boolean {
  if (error == null || typeof error !== 'string') return false;
  const t = error.trim();
  if (!t) return false;
  if (t === MASS_SEND_INSTANCE_DISCONNECTED_USER_MESSAGE) return true;
  if (/caiu ou foi desconectada/i.test(t) && /reconecte/i.test(t)) return true;
  if (/«[^»]+».*caiu ou foi desconectada/i.test(t)) return true;
  return messageIndicatesEvolutionSessionDropped(t);
}

/**
 * Converte respostas HTML (502/503/504), páginas nginx, etc. em texto legível.
 */
export function sanitizeMassSendErrorMessage(raw: string | null | undefined): string {
  if (raw == null || typeof raw !== 'string') return '';
  const t = raw.trim();
  if (!t) return '';

  if (t === '[object Object]' || /^\[object \w+\]$/.test(t)) {
    return 'A Evolution API retornou um erro sem mensagem legível (objeto). Verifique os logs do servidor [MassSend] e a instância.';
  }

  if (messageIndicatesEvolutionSessionDropped(t)) {
    return MASS_SEND_INSTANCE_DISCONNECTED_USER_MESSAGE;
  }

  if (t.startsWith('<') || /<\s*html[\s>]/i.test(t) || /<\s*!doctype/i.test(t)) {
    return 'Gateway ou proxy retornou página HTML em vez de JSON (502/503/504). Verifique Evolution API, nginx e a instância.';
  }

  if (/502\s*bad\s*gateway/i.test(t) || (/\b502\b/i.test(t) && /bad\s*gateway/i.test(t))) {
    return '502 Bad Gateway: Evolution API ou proxy indisponível. Tente novamente em instantes.';
  }

  if (/504\s*gateway/i.test(t) || (/\b504\b/i.test(t) && /gateway|timeout/i.test(t))) {
    return '504 Gateway Timeout: tempo esgotado no proxy. Tente menos grupos ou verifique a rede.';
  }

  if (/503\s*service\s*unavailable/i.test(t) || /\b503\b/i.test(t)) {
    return '503 Serviço indisponível. Tente novamente em instantes.';
  }

  if (/inactivity\s*timeout/i.test(t)) {
    return 'Timeout de inatividade no proxy durante o envio. Tente novamente.';
  }

  if (/nginx/i.test(t) && /<[^>]+>/.test(t)) {
    return 'Resposta HTML do nginx/proxy em vez de JSON. Verifique Evolution API e conectividade.';
  }

  return t.length > MAX_LEN ? `${t.slice(0, MAX_LEN)}…` : t;
}
