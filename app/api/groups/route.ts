import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { deduplicateGroupsByInstance, normalizeGroupId } from '@/lib/utils/group-utils';

/**
 * GET /api/groups - Lista grupos salvos do usuário
 * Deduplica por (instance_name, group_id) para evitar bugs visuais.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = req.nextUrl;
    const instanceName = searchParams.get('instanceName');

    let query = supabaseServiceRole
      .from('whatsapp_groups')
      .select('group_id, group_subject, instance_name')
      .eq('user_id', userId)
      .order('group_subject', { ascending: true });

    if (instanceName) {
      query = query.eq('instance_name', instanceName);
    }

    const { data, error } = await query;

    if (error) {
      return errorResponse(`Erro ao buscar grupos: ${error.message}`);
    }

    const raw = (data || []) as { group_id: string; group_subject: string | null; instance_name?: string }[];
    const deduped = deduplicateGroupsByInstance(raw);
    // Retorna no formato original (group_id, group_subject) para compatibilidade
    const result = deduped.map(({ group_id, group_subject }) => ({ group_id, group_subject }));

    return successResponse(result);
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar grupos', 401);
  }
}

/**
 * POST /api/groups - Salva um grupo (evita duplicatas: mesmo user + mesma instância + mesmo group_id)
 * Se o grupo já existir para o usuário na mesma instância, apenas atualiza (group_subject, etc.)
 * Group_id é normalizado para evitar duplicatas por variação de formato.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { instanceName, groupId, groupSubject, pictureUrl, size } = body;

    if (!instanceName || !groupId) {
      return errorResponse('instanceName e groupId são obrigatórios', 400);
    }

    const normalizedGroupId = normalizeGroupId(groupId);
    if (!normalizedGroupId) {
      return errorResponse('groupId inválido', 400);
    }

    // Verifica se já existe (user + instance + group_id) para evitar duplicata
    const { data: existing } = await supabaseServiceRole
      .from('whatsapp_groups')
      .select('id')
      .eq('user_id', userId)
      .eq('instance_name', instanceName)
      .eq('group_id', normalizedGroupId)
      .limit(1)
      .maybeSingle();

    if (existing) {
      // Atualiza apenas para manter group_subject, picture_url, size em dia
      const { error: updateError } = await supabaseServiceRole
        .from('whatsapp_groups')
        .update({
          group_subject: groupSubject || null,
          picture_url: pictureUrl || null,
          size: size ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (updateError) {
        return errorResponse(`Erro ao atualizar grupo: ${updateError.message}`);
      }
      return successResponse(null, 'Grupo já existe no banco (atualizado)');
    }

    // Não existe: insere
    const { data, error } = await supabaseServiceRole
      .from('whatsapp_groups')
      .insert({
        user_id: userId,
        instance_name: instanceName,
        group_id: normalizedGroupId,
        group_subject: groupSubject || null,
        picture_url: pictureUrl || null,
        size: size || null,
      })
      .select()
      .single();

    if (error) {
      // Fallback: se for erro de duplicata (constraint existente), considera sucesso
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

