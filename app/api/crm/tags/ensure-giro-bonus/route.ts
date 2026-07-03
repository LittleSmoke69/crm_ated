import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const GIRO_BONUS_LABEL = 'Recebeu bonus de Giro';
const GIRO_BONUS_COLOR = '#E86A24';

/**
 * GET /api/crm/tags/ensure-giro-bonus
 * Retorna o id da etiqueta "Recebeu bonus de Giro", criando-a se não existir.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);

    const { data: existing } = await supabaseServiceRole
      .from('crm_tags')
      .select('id')
      .ilike('label', GIRO_BONUS_LABEL)
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      return successResponse({ tagId: existing.id });
    }

    const { data: created, error } = await supabaseServiceRole
      .from('crm_tags')
      .insert({ label: GIRO_BONUS_LABEL, color: GIRO_BONUS_COLOR })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') {
        const { data: retry } = await supabaseServiceRole
          .from('crm_tags')
          .select('id')
          .ilike('label', GIRO_BONUS_LABEL)
          .limit(1)
          .maybeSingle();
        if (retry?.id) return successResponse({ tagId: retry.id });
      }
      return errorResponse(`Erro ao garantir etiqueta: ${error.message}`, 500);
    }

    return successResponse({ tagId: created.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(msg || 'Erro ao garantir etiqueta.');
  }
}
