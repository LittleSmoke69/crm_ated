import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * PATCH /api/crm/messages/[id] - Atualiza uma mensagem
 * Permite atualizar: título, conteúdo, preview, categoria, favorito, anexo
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { id: messageId } = await params;

    const body = await req.json();
    const { 
      title, 
      content, 
      preview, 
      category, 
      is_favorite, 
      has_attachment,
      attachment_with_caption,
      mention_all,
      message_type,
      attachment_url,
      send_intelligent,
      training_asset_id,
      training_dataset_item_id,
      ptv_delay,
    } = body;

    // Verifica se a mensagem existe e se o usuário tem permissão
    const { data: existingMessage, error: fetchError } = await supabaseServiceRole
      .from('messages')
      .select('user_id')
      .eq('id', messageId)
      .single();

    if (fetchError || !existingMessage) {
      return errorResponse('Mensagem não encontrada', 404);
    }

    // Verifica se é admin ou dono da mensagem
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const isAdmin = profile?.status === 'admin';
    const isOwner = existingMessage.user_id === userId;

    if (!isAdmin && !isOwner) {
      return errorResponse('Acesso negado. Você não tem permissão para editar esta mensagem.', 403);
    }

    // Monta objeto de atualização
    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (title !== undefined) updateData.title = title.trim();
    if (content !== undefined) {
      // Permite conteúdo vazio para mensagens de áudio
      updateData.content = content.trim();
      // Atualiza preview se não foi fornecido explicitamente
      if (preview === undefined) {
        updateData.preview = content 
          ? content.substring(0, 100) + (content.length > 100 ? '...' : '')
          : 'Mensagem de áudio';
      }
    }
    if (preview !== undefined) updateData.preview = preview;
    if (category !== undefined) updateData.category = category;
    if (is_favorite !== undefined) updateData.is_favorite = is_favorite;
    if (has_attachment !== undefined) updateData.has_attachment = has_attachment;
    if (attachment_with_caption !== undefined) updateData.attachment_with_caption = attachment_with_caption;
    if (mention_all !== undefined) updateData.mention_all = mention_all;
    if (message_type !== undefined) updateData.message_type = message_type;
    if (attachment_url !== undefined) updateData.attachment_url = attachment_url;
    if (send_intelligent !== undefined) updateData.send_intelligent = send_intelligent;
    if (training_asset_id !== undefined) updateData.training_asset_id = training_asset_id;
    if (training_dataset_item_id !== undefined) updateData.training_dataset_item_id = training_dataset_item_id;
    if (ptv_delay !== undefined && typeof ptv_delay === 'number' && ptv_delay >= 0) updateData.ptv_delay = ptv_delay;

    const { data: message, error } = await supabaseServiceRole
      .from('messages')
      .update(updateData)
      .eq('id', messageId)
      .select(`
        *,
        profiles:user_id (
          id,
          email,
          full_name
        )
      `)
      .single();

    if (error) {
      return errorResponse(`Erro ao atualizar mensagem: ${error.message}`);
    }

    return successResponse(message);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * DELETE /api/crm/messages/[id] - Deleta uma mensagem
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { id: messageId } = await params;

    // Verifica se a mensagem existe e se o usuário tem permissão
    const { data: existingMessage, error: fetchError } = await supabaseServiceRole
      .from('messages')
      .select('user_id')
      .eq('id', messageId)
      .single();

    if (fetchError || !existingMessage) {
      return errorResponse('Mensagem não encontrada', 404);
    }

    // Verifica se é admin ou dono da mensagem
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const isAdmin = profile?.status === 'admin';
    const isOwner = existingMessage.user_id === userId;

    if (!isAdmin && !isOwner) {
      return errorResponse('Acesso negado. Você não tem permissão para deletar esta mensagem.', 403);
    }

    const { error } = await supabaseServiceRole
      .from('messages')
      .delete()
      .eq('id', messageId);

    if (error) {
      return errorResponse(`Erro ao deletar mensagem: ${error.message}`);
    }

    return successResponse({ message: 'Mensagem deletada com sucesso' });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

