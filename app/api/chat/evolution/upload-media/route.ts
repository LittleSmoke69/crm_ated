/**
 * POST /api/chat/evolution/upload-media
 * FormData: file (File), instance_id (string)
 * Faz upload para o bucket chat-media e retorna URL pública + media_type.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { canUserAccessEvolutionChatInstance } from '@/lib/services/atendimento-chat-access';

const CHAT_MEDIA_BUCKET = 'chat-media';
const ALLOWED_AUDIO = ['audio/ogg', 'audio/mpeg', 'audio/webm', 'audio/mp4', 'audio/m4a', 'audio/x-m4a'] as const;
const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_AUDIO = 16 * 1024 * 1024; // 16MB
const MAX_IMAGE = 10 * 1024 * 1024; // 10MB

export async function POST(req: NextRequest) {
  let userId: string | undefined;
  try {
    const auth = await requireAuth(req);
    userId = auth.userId;
  } catch (err: any) {
    const msg = err?.message ?? 'Não autenticado';
    if (msg.includes('autenticado') || msg.includes('inválido')) return errorResponse(msg, 401);
    return errorResponse('Não autenticado', 401);
  }

  try {
    const formData = await req.formData().catch(() => null);
    if (!formData) return errorResponse('FormData inválido', 400);

    const file = formData.get('file') as File | null;
    const instance_id = formData.get('instance_id') as string | null;
    if (!file || !file.size) return errorResponse('Arquivo obrigatório', 400);
    if (!instance_id || typeof instance_id !== 'string') return errorResponse('instance_id obrigatório', 400);

    const mimeType = (file.type || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    const isAudio = ALLOWED_AUDIO.includes(mimeType as (typeof ALLOWED_AUDIO)[number]);
    const isImage = ALLOWED_IMAGE.includes(mimeType as (typeof ALLOWED_IMAGE)[number]);
    if (!isAudio && !isImage) {
      return errorResponse(`Tipo de mídia não permitido: ${mimeType}`, 400);
    }
    if (isAudio && file.size > MAX_AUDIO) return errorResponse('Áudio muito grande. Máximo: 16MB', 400);
    if (isImage && file.size > MAX_IMAGE) return errorResponse('Imagem muito grande. Máximo: 10MB', 400);

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const status = String(profile?.status || '').toLowerCase();
    const isAdminOrSuporte = status === 'super_admin' || status === 'admin' || status === 'suporte';
    if (!isAdminOrSuporte) {
      const allowed = await canUserAccessEvolutionChatInstance(userId!, profile || {}, instance_id);
      if (!allowed) return errorResponse('Acesso negado a esta instância.', 403);
    }

    const timestamp = Date.now();
    const safeName = (file.name || 'audio').replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `uploads/evolution/${instance_id}/${timestamp}-${safeName}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await supabaseServiceRole.storage
      .from(CHAT_MEDIA_BUCKET)
      .upload(storagePath, buffer, { contentType: mimeType, upsert: true });

    if (uploadError) return errorResponse('Falha no upload da mídia', 500);

    const { data: urlData } = supabaseServiceRole.storage
      .from(CHAT_MEDIA_BUCKET)
      .getPublicUrl(storagePath);

    return successResponse({
      url: urlData.publicUrl,
      media_type: isImage ? 'image' : 'audio',
      mime_type: mimeType,
    });
  } catch (err: any) {
    return serverErrorResponse(err as Error);
  }
}

