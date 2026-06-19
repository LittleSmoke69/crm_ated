/**
 * PUT    /api/admin/meta/investment-rounds/[id]   Atualiza janela/meta/label.
 * DELETE /api/admin/meta/investment-rounds/[id]   Remove a rodada.
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
    const { id } = await params;
    if (!id) return errorResponse('id é obrigatório.', 400);

    const body = await req.json();
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body?.data_inicial != null) {
      const v = String(body.data_inicial).trim();
      if (!YMD.test(v)) return errorResponse('data_inicial deve ser YYYY-MM-DD.', 400);
      patch.data_inicial = v;
    }
    if (body?.data_final != null) {
      const v = String(body.data_final).trim();
      if (!YMD.test(v)) return errorResponse('data_final deve ser YYYY-MM-DD.', 400);
      patch.data_final = v;
    }
    if (body?.meta_gasto != null) {
      const v = Number(body.meta_gasto);
      if (!Number.isFinite(v) || v <= 0) return errorResponse('meta_gasto deve ser maior que zero.', 400);
      patch.meta_gasto = v;
    }
    if (body?.label !== undefined) {
      patch.label = body.label != null ? String(body.label).trim() || null : null;
    }

    // Busca rodada atual para validar janela resultante + sobreposição.
    const { data: current, error: curErr } = await supabaseServiceRole
      .from('meta_investment_rounds')
      .select('id, consultor_id, data_inicial, data_final')
      .eq('id', id)
      .maybeSingle();
    if (curErr) return errorResponse(curErr.message, 500);
    if (!current) return errorResponse('Rodada não encontrada.', 404);

    const nextStart = (patch.data_inicial as string) ?? current.data_inicial;
    const nextEnd = (patch.data_final as string) ?? current.data_final;
    if (nextEnd < nextStart) {
      return errorResponse('data_final não pode ser anterior a data_inicial.', 400);
    }

    if (patch.data_inicial != null || patch.data_final != null) {
      const { data: overlaps, error: ovErr } = await supabaseServiceRole
        .from('meta_investment_rounds')
        .select('id')
        .eq('consultor_id', current.consultor_id)
        .neq('id', id)
        .lte('data_inicial', nextEnd)
        .gte('data_final', nextStart);
      if (ovErr) return errorResponse(ovErr.message, 500);
      if ((overlaps ?? []).length > 0) {
        return errorResponse('A nova janela sobrepõe outra rodada deste consultor.', 409);
      }
    }

    const { data: updated, error: updErr } = await supabaseServiceRole
      .from('meta_investment_rounds')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (updErr) return errorResponse(updErr.message, 500);

    return successResponse({ round: updated }, 'Rodada atualizada.');
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
    const { id } = await params;
    if (!id) return errorResponse('id é obrigatório.', 400);

    const { error } = await supabaseServiceRole.from('meta_investment_rounds').delete().eq('id', id);
    if (error) return errorResponse(error.message, 500);
    return successResponse({ deleted: true }, 'Rodada removida.');
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
