/**
 * Mensagens de erro de disparo de ativação: evita persistir HTML de nginx/502 na UI e no banco.
 */

import { messageIndicatesEvolutionSessionDropped } from '@/lib/evolution/mark-instance-disconnected';

const MAX_LEN = 500;

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
 * Converte respostas HTML (502/503/504), páginas nginx, etc. em texto legível.
 */
export function sanitizeMassSendErrorMessage(raw: string | null | undefined): string {
  if (raw == null || typeof raw !== 'string') return '';
  const t = raw.trim();
  if (!t) return '';

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
