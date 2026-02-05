import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/crm/messages - Lista mensagens
 * - Admin: vê todas as mensagens de todos os usuários
 * - Usuário normal: vê apenas suas próprias mensagens
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    // Verifica se o usuário é admin
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const isAdmin = profile?.status === 'admin';

    // Busca mensagens
    let query = supabaseServiceRole
      .from('messages')
      .select(`
        *,
        profiles:user_id (
          id,
          email,
          full_name
        )
      `)
      .order('created_at', { ascending: false });
    
    // Inclui campos de mídia se existirem

    // Se não for admin, filtra apenas mensagens do usuário
    if (!isAdmin) {
      query = query.eq('user_id', userId);
    }

    const { data: messages, error } = await query;

    if (error) {
      return errorResponse(`Erro ao buscar mensagens: ${error.message}`);
    }

    return successResponse(messages || []);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * POST /api/crm/messages - Cria uma nova mensagem
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const body = await req.json();
    const { 
      title, 
      content, 
      preview, 
      category, 
      has_attachment,
      attachment_with_caption,
      mention_all,
      message_type,
      attachment_url,
      send_intelligent
    } = body;

    // Validações
    if (!title) {
      return errorResponse('Título é obrigatório', 400);
    }
    
    // Conteúdo só é obrigatório se não for mensagem de áudio
    if (message_type !== 'audio' && !content) {
      return errorResponse('Conteúdo é obrigatório', 400);
    }

    // Gera preview automaticamente se não fornecido
    // Para áudio sem conteúdo, usa um preview padrão
    const messagePreview = preview || (content 
      ? content.substring(0, 100) + (content.length > 100 ? '...' : '')
      : 'Mensagem de áudio');

    const { data: message, error } = await supabaseServiceRole
      .from('messages')
      .insert({
        user_id: userId,
        title: title.trim(),
        content: content ? content.trim() : '', // Permite conteúdo vazio para áudio
        preview: messagePreview,
        category: category || 'Boas vindas',
        is_favorite: false,
        has_attachment: has_attachment || false,
        attachment_with_caption: attachment_with_caption || false,
        mention_all: mention_all || false,
        message_type: message_type || 'text_only',
        attachment_url: attachment_url || null,
        send_intelligent: send_intelligent || false,
        updated_at: new Date().toISOString(),
      })
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
      return errorResponse(`Erro ao criar mensagem: ${error.message}`);
    }

    return successResponse(message);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

