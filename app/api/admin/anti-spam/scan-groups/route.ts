/**
 * POST /api/admin/anti-spam/scan-groups
 * Dispara o scanner de grupos em tempo real. A varredura agendada costuma rodar a cada 20 min no ambiente de deploy.
 * ou manualmente pelo admin. Retorna resultados parciais (batches).
 */

import { NextRequest } from 'next/server';
import { requireAntiSpamAccess } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { runGroupScanner } from '@/lib/anti-spam/group-scanner';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    await requireAntiSpamAccess(req);

    const body = await req.json().catch(() => ({}));
    const mode = body.mode === 'dry_run' ? 'dry_run' : 'live';

    if (mode === 'dry_run') {
      return successResponse({ mode: 'dry_run', message: 'Modo de simulação — ainda não implementado' });
    }

    const results = await runGroupScanner();
    return successResponse({
      configs_scanned: results.length,
      total_groups: results.reduce((s, r) => s + r.total_groups, 0),
      total_removed: results.reduce((s, r) => s + r.total_removed, 0),
      total_errors: results.reduce((s, r) => s + r.total_errors, 0),
      configs: results,
    });
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao escanear grupos', 500);
  }
}
