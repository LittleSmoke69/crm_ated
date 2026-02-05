/**
 * POST /api/campaigns/trigger-queue
 *
 * Dispara o processamento da fila de campanhas (jobs em campaign_contacts).
 * Usado quando há campanhas ativas e queremos que processados/falhas atualizem
 * sem depender apenas do cron da Netlify (ex.: em dev ou quando o cron não está ativo).
 *
 * Se PROCESS_CAMPAIGN_QUEUE_URL estiver definida, chama essa URL (Netlify function).
 * Caso contrário, retorna 200 sem efeito (o cron da Netlify continua responsável em produção).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';

const TRIGGER_URL = process.env.PROCESS_CAMPAIGN_QUEUE_URL || process.env.NEXT_PUBLIC_PROCESS_CAMPAIGN_QUEUE_URL || '';
const TRIGGER_TIMEOUT_MS = 5000;

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
  } catch {
    return errorResponse('Não autenticado', 401);
  }

  if (!TRIGGER_URL.trim()) {
    return successResponse(
      { triggered: false, reason: 'PROCESS_CAMPAIGN_QUEUE_URL não configurada' },
      'Nenhum processador configurado'
    );
  }

  const url = TRIGGER_URL.trim();
  if (!url.startsWith('http')) {
    return successResponse(
      { triggered: false, reason: 'URL inválida' },
      'URL de processamento inválida'
    );
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TRIGGER_TIMEOUT_MS);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return successResponse(
      { triggered: true, status: res.status, url },
      'Processamento da fila disparado'
    );
  } catch (err: any) {
    const message = err?.message || String(err);
    if (message.includes('abort')) {
      return successResponse(
        { triggered: true, timeout: true },
        'Processamento disparado (timeout esperado)'
      );
    }
    return successResponse(
      { triggered: false, error: message },
      'Falha ao disparar processamento (fila pode ser processada pelo cron)'
    );
  }
}
