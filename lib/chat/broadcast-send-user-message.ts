import { messageIndicatesEvolutionSessionDropped } from '@/lib/evolution/mark-instance-disconnected';

/**
 * Texto amigável para erros de envio no disparo em massa (Evolution via chatService).
 * HTTP 400 sem indício de sessão encerrada costuma ser número/contato inválido ou indisponível.
 */
export function publicBroadcastSendErrorMessage(raw: string | null | undefined): string {
  const msg = String(raw ?? '');
  if (!msg.trim()) return '';
  if (messageIndicatesEvolutionSessionDropped(msg)) return msg;
  if (/Erro ao enviar mensagem:\s*400\b/i.test(msg)) {
    return 'O contato não estava disponível.';
  }
  return msg;
}
