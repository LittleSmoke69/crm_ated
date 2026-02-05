import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/groups - Lista grupos salvos do usuário
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = req.nextUrl;
    const instanceName = searchParams.get('instanceName');

    let query = supabaseServiceRole
      .from('whatsapp_groups')
      .select('group_id, group_subject')
      .eq('user_id', userId)
      .order('group_subject', { ascending: true });

    if (instanceName) {
      query = query.eq('instance_name', instanceName);
    }

    const { data, error } = await query;

    if (error) {
      return errorResponse(`Erro ao buscar grupos: ${error.message}`);
    }

    return successResponse(data || []);
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar grupos', 401);
  }
}

/**
 * POST /api/groups - Salva um grupo
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { instanceName, groupId, groupSubject, pictureUrl, size } = body;

    if (!instanceName || !groupId) {
      return errorResponse('instanceName e groupId são obrigatórios', 400);
    }

    const { data, error } = await supabaseServiceRole
      .from('whatsapp_groups')
      .insert({
        user_id: userId,
        instance_name: instanceName,
        group_id: groupId,
        group_subject: groupSubject || null,
        picture_url: pictureUrl || null,
        size: size || null,
      })
      .select()
      .single();

    if (error) {
      // Se for erro de duplicata, retorna sucesso
      if ((error as any).code === '23505') {
        return successResponse(null, 'Grupo já existe no banco');
      }
      return errorResponse(`Erro ao salvar grupo: ${error.message}`);
    }

    return successResponse(data, 'Grupo salvo com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

