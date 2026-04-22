/**
 * PATCH /api/admin/crm/bancas/lead-transfer-lock
 * Super admin: suspende ou libera transferências de leads para uma banca (crm_bancas.lead_transfer_locked).
 */

import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';
import { z } from 'zod';

const bodySchema = z.object({
  banca_id: z.string().uuid(),
  locked: z.boolean(),
});

const LOG_PREFIX = '[admin][crm][bancas][lead-transfer-lock]';

export async function PATCH(req: NextRequest) {
  try {
    const { profile } = await requireSuperAdmin(req);
    const zaplotoId = await getEffectiveZaplotoId(req, profile);
    const raw = await req.json();
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return errorResponse(parsed.error?.issues?.[0]?.message ?? 'banca_id e locked são obrigatórios.', 400);
    }
    const { banca_id, locked } = parsed.data;

    const { data: exists, error: fetchErr } = await (zaplotoId
      ? supabaseServiceRole
          .from('crm_bancas')
          .select('id')
          .eq('id', banca_id)
          .or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`)
          .maybeSingle()
      : supabaseServiceRole.from('crm_bancas').select('id').eq('id', banca_id).maybeSingle());

    if (fetchErr || !exists?.id) {
      return errorResponse('Banca não encontrada ou fora do escopo do tenant.', 404);
    }

    const { error: updErr } = await supabaseServiceRole
      .from('crm_bancas')
      .update({ lead_transfer_locked: locked } as never)
      .eq('id', banca_id);

    if (updErr) {
      if (updErr.message?.includes('lead_transfer_locked') || updErr.code === 'PGRST204') {
        return errorResponse(
          'Coluna lead_transfer_locked ausente no banco. Aplique a migration add_crm_bancas_lead_transfer_locked.sql.',
          500
        );
      }
      console.error(`${LOG_PREFIX} update error:`, updErr);
      return errorResponse(`Erro ao atualizar: ${updErr.message}`, 500);
    }

    console.log(`${LOG_PREFIX} banca=${banca_id} locked=${locked}`);
    return successResponse({ banca_id, locked });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Acesso negado')) return errorResponse(msg, 403);
    return serverErrorResponse(err as Error);
  }
}
