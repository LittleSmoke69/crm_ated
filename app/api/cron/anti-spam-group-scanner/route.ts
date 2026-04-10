/**
 * POST /api/cron/anti-spam-group-scanner
 *
 * Cron de scanner de grupos — roda a cada 1 minuto (agendamento no netlify.toml).
 * Escaneia todos os grupos das configs ativas, remove números na blacklist e internacionais.
 * Salva logs em anti_spam_scan_jobs para controle via admin.
 *
 * Header: x-cron-secret = env.ANTI_SPAM_CRON_SECRET
 */

import { NextRequest } from 'next/server';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { runGroupScanner } from '@/lib/anti-spam/group-scanner';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')?.trim() || '';
  const expected = process.env.ANTI_SPAM_CRON_SECRET?.trim();
  if (!expected) {
    return new Response(JSON.stringify({ success: false, error: 'Cron não configurado (ANTI_SPAM_CRON_SECRET).' }), {
      status: 501,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (secret !== expected) {
    return new Response(JSON.stringify({ success: false, error: 'Não autorizado.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Se passou pela verificação de secret, executa o scanner direto
  try {
    const results = await runGroupScanner();
    return successResponse({
      configs_scanned: results.length,
      total_groups: results.reduce((s, r) => s + r.total_groups, 0),
      total_removed: results.reduce((s, r) => s + r.total_removed, 0),
      total_errors: results.reduce((s, r) => s + r.total_errors, 0),
    });
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}
