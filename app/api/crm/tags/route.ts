import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/crm/tags - Lista todas as etiquetas (para uso nos filtros)
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);

    const { data: tags, error } = await supabaseServiceRole
      .from('crm_tags')
      .select('*')
      .order('label', { ascending: true });

    if (error) {
      console.error('[CRM Tags] Erro ao buscar tags:', error);
      return errorResponse(`Erro ao buscar etiquetas: ${error.message}`, 500);
    }

    return successResponse(tags || []);
  } catch (err: any) {
    console.error('[CRM Tags] Erro inesperado:', err);
    return serverErrorResponse(err);
  }
}

/**
 * POST /api/crm/tags - Cria uma nova etiqueta (apenas admin)
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    await requireStatus(req, ['super_admin', 'admin']);

    const body = await req.json();
    const { label, color, move_to_column_key } = body;

    if (!label || !color) {
      return errorResponse('label e color são obrigatórios', 400);
    }

    // Valida formato da cor (hex)
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
      return errorResponse('Cor inválida. Use formato hexadecimal (ex: #E86A24)', 400);
    }

    const { data: tag, error } = await supabaseServiceRole
      .from('crm_tags')
      .insert({
        label: label.trim(),
        color: color.toUpperCase(),
        move_to_column_key: typeof move_to_column_key === 'string' && move_to_column_key ? move_to_column_key : null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return errorResponse('Uma etiqueta com este nome já existe', 400);
      }
      return errorResponse(`Erro ao criar etiqueta: ${error.message}`, 500);
    }

    return successResponse(tag, 'Etiqueta criada com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

