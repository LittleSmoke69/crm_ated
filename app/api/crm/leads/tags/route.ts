import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { canAccessUser } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * POST /api/crm/leads/tags - Adiciona uma tag a um lead
 */
export async function POST(req: NextRequest) {
  try {
    const { userId: requesterId } = await requireAuth(req);
    const body = await req.json();
    const { leadId, tagId, targetUserId } = body;

    if (!leadId || !tagId) {
      return errorResponse('leadId e tagId são obrigatórios', 400);
    }

    // Se targetUserId foi fornecido, verifica permissão (para gerentes adicionarem tags nos leads dos consultores)
    const userIdToUse = targetUserId || requesterId;
    
    if (userIdToUse !== requesterId) {
      const hasPermission = await canAccessUser(requesterId, userIdToUse);
      if (!hasPermission) {
        return errorResponse('Acesso negado. Você não tem permissão para adicionar etiquetas neste lead.', 403);
      }
    }

    // Verifica se a tag existe
    const { data: tag, error: tagError } = await supabaseServiceRole
      .from('crm_tags')
      .select('id')
      .eq('id', tagId)
      .single();

    if (tagError || !tag) {
      return errorResponse('Tag não encontrada', 404);
    }

    // Verifica se a tag já está associada ao lead (evita duplicatas)
    const { data: existingTag, error: checkError } = await supabaseServiceRole
      .from('crm_lead_tags')
      .select('id')
      .eq('lead_external_id', leadId.toString())
      .eq('user_id', userIdToUse)
      .eq('tag_id', tagId)
      .single();

    if (existingTag) {
      return errorResponse('Esta etiqueta já está associada a este lead', 400);
    }

    // Adiciona a tag ao lead
    const { data: leadTag, error: insertError } = await supabaseServiceRole
      .from('crm_lead_tags')
      .insert({
        lead_external_id: leadId.toString(),
        user_id: userIdToUse,
        tag_id: tagId,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[CRM Lead Tags] Erro ao adicionar tag:', insertError);
      return errorResponse(`Erro ao adicionar etiqueta: ${insertError.message}`, 500);
    }

    return successResponse(leadTag, 'Etiqueta adicionada com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * DELETE /api/crm/leads/tags - Remove uma tag de um lead
 */
export async function DELETE(req: NextRequest) {
  try {
    const { userId: requesterId } = await requireAuth(req);
    const { searchParams } = req.nextUrl;
    const leadId = searchParams.get('leadId');
    const tagId = searchParams.get('tagId');
    const targetUserId = searchParams.get('targetUserId');

    if (!leadId || !tagId) {
      return errorResponse('leadId e tagId são obrigatórios', 400);
    }

    // Se targetUserId foi fornecido, verifica permissão
    const userIdToUse = targetUserId || requesterId;
    
    if (userIdToUse !== requesterId) {
      const hasPermission = await canAccessUser(requesterId, userIdToUse);
      if (!hasPermission) {
        return errorResponse('Acesso negado. Você não tem permissão para remover etiquetas deste lead.', 403);
      }
    }

    // Remove a tag do lead
    const { error: deleteError } = await supabaseServiceRole
      .from('crm_lead_tags')
      .delete()
      .eq('lead_external_id', leadId.toString())
      .eq('user_id', userIdToUse)
      .eq('tag_id', tagId);

    if (deleteError) {
      console.error('[CRM Lead Tags] Erro ao remover tag:', deleteError);
      return errorResponse(`Erro ao remover etiqueta: ${deleteError.message}`, 500);
    }

    return successResponse(null, 'Etiqueta removida com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

