/**
 * POST /api/admin/anti-spam/test-run
 * Simula processamento do último lote (dispara um ciclo do worker).
 * RBAC: super_admin, admin, auditoria
 */

import { NextRequest } from 'next/server';
import { requireAntiSpamAccess } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';

export const runtime = 'nodejs';

async function runOneCycle(): Promise<void> {
  const { runCycle } = await import('@/lib/anti-spam/antiSpamWorker');
  await runCycle();
}

export async function POST(req: NextRequest) {
  try {
    await requireAntiSpamAccess(req);
    await runOneCycle();
    return successResponse({ ok: true }, 'Ciclo executado');
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao executar ciclo', 500);
  }
}
