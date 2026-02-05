import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/admin/crm/tags - Lista todas as etiquetas
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { data: tags, error } = await supabaseServiceRole
      .from('crm_tags')
      .select('*')
      .order('label', { ascending: true });

    if (error) {
      return errorResponse(`Erro ao buscar etiquetas: ${error.message}`);
    }

    return successResponse(tags);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * POST /api/admin/crm/tags - Cria uma nova etiqueta
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);

    const body = await req.json();
    const { label, color } = body;

    if (!label || !color) {
      return errorResponse('Label e cor são obrigatórios', 400);
    }

    // Valida formato da cor (hex)
    if (!/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color)) {
      return errorResponse('Cor deve estar no formato hexadecimal (ex: #8CD955)', 400);
    }

    const { data, error } = await supabaseServiceRole
      .from('crm_tags')
      .insert({ label: label.trim(), color })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') { // Unique constraint violation
        return errorResponse('Já existe uma etiqueta com este nome', 400);
      }
      return errorResponse(`Erro ao criar etiqueta: ${error.message}`);
    }

    return successResponse(data, 'Etiqueta criada com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * DELETE /api/admin/crm/tags - Remove uma etiqueta
 */
export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return errorResponse('ID da etiqueta é obrigatório', 400);
    }

    const { error } = await supabaseServiceRole
      .from('crm_tags')
      .delete()
      .eq('id', id);

    if (error) {
      return errorResponse(`Erro ao excluir etiqueta: ${error.message}`);
    }

    return successResponse(null, 'Etiqueta excluída com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

