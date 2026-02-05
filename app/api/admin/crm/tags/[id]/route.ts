import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * PATCH /api/admin/crm/tags/[id] - Atualiza uma etiqueta
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);
    const resolvedParams = await params;
    const id = resolvedParams.id;

    const body = await req.json();
    const { label, color } = body;

    const updateData: any = { updated_at: new Date().toISOString() };
    
    if (label !== undefined) {
      updateData.label = label.trim();
    }
    
    if (color !== undefined) {
      // Valida formato da cor (hex)
      if (!/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color)) {
        return errorResponse('Cor deve estar no formato hexadecimal (ex: #8CD955)', 400);
      }
      updateData.color = color;
    }

    const { data, error } = await supabaseServiceRole
      .from('crm_tags')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') { // Unique constraint violation
        return errorResponse('Já existe uma etiqueta com este nome', 400);
      }
      return errorResponse(`Erro ao atualizar etiqueta: ${error.message}`);
    }

    return successResponse(data, 'Etiqueta atualizada com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

