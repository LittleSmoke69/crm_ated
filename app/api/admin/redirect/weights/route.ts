import { NextRequest } from 'next/server';
import { requireVslProjectAccess } from '@/lib/middleware/vsl-admin';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

/**
 * PATCH /api/admin/redirect/weights
 * Atualiza pesos em lote. Body: { project_id, weights: [{ group_id, weight_percent }] }.
 * Exige soma = 100.
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as {
      project_id?: string;
      weights?: Array<{ group_id: string; weight_percent: number }>;
    };
    const { project_id, weights } = body;
    if (!project_id || !Array.isArray(weights) || weights.length === 0) {
      return errorResponse('project_id e weights (array) são obrigatórios', 400);
    }
    await requireVslProjectAccess(req, project_id);

    const sum = weights.reduce((s, w) => s + (Number(w.weight_percent) || 0), 0);
    if (Math.abs(sum - 100) > 0.01) {
      return errorResponse('A soma das porcentagens deve ser 100', 400);
    }

    for (const w of weights) {
      const percent = Math.min(100, Math.max(0, Number(w.weight_percent)));
      const { data: g } = await supabaseServiceRole
        .from('redirect_groups')
        .select('project_id')
        .eq('id', w.group_id)
        .single();
      if (!g || g.project_id !== project_id) {
        return errorResponse(`Grupo ${w.group_id} não pertence ao projeto`, 400);
      }
      await supabaseServiceRole
        .from('redirect_groups')
        .update({ weight_percent: percent, updated_at: new Date().toISOString() })
        .eq('id', w.group_id);
    }

    return successResponse({ ok: true });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}
