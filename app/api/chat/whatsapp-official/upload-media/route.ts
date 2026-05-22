/**
 * POST /api/chat/whatsapp-official/upload-media
 * FormData: file (File), config_id (string)
 * Faz upload para o bucket chat-media e retorna URL pública + media_type.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { inferMimeFromFileName } from '@/lib/chat/document-file-utils';

const CHAT_MEDIA_BUCKET = 'chat-media';

const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp'] as const;
const ALLOWED_AUDIO = ['audio/ogg', 'audio/mpeg', 'audio/webm', 'audio/mp4', 'audio/m4a', 'audio/x-m4a'] as const;
const ALLOWED_VIDEO = ['video/mp4'] as const;
const ALLOWED_DOCUMENT = [
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

const MAX_IMAGE = 5 * 1024 * 1024;   // 5MB
const MAX_AUDIO = 16 * 1024 * 1024;  // 16MB
const MAX_VIDEO = 16 * 1024 * 1024;  // 16MB
const MAX_DOCUMENT = 100 * 1024 * 1024; // 100MB

function inferMediaType(mime: string, fileName: string): 'image' | 'audio' | 'video' | 'document' {
  const lower = mime.toLowerCase();
  if (ALLOWED_IMAGE.some((t) => lower === t)) return 'image';
  if (ALLOWED_AUDIO.some((t) => lower === t)) return 'audio';
  if (ALLOWED_VIDEO.some((t) => lower === t)) return 'video';
  if (ALLOWED_DOCUMENT.some((t) => lower === t)) return 'document';
  const fromName = inferMimeFromFileName(fileName);
  if (fromName) {
    if (ALLOWED_IMAGE.some((t) => fromName === t)) return 'image';
    if (ALLOWED_AUDIO.some((t) => fromName === t)) return 'audio';
    if (ALLOWED_VIDEO.some((t) => fromName === t)) return 'video';
    if (ALLOWED_DOCUMENT.some((t) => fromName === t)) return 'document';
  }
  return 'document';
}

function getMaxSize(mediaType: 'image' | 'audio' | 'video' | 'document'): number {
  switch (mediaType) {
    case 'image': return MAX_IMAGE;
    case 'audio': return MAX_AUDIO;
    case 'video': return MAX_VIDEO;
    case 'document': return MAX_DOCUMENT;
    default: return MAX_DOCUMENT;
  }
}

export async function POST(req: NextRequest) {
  let userId: string | undefined;
  try {
    const auth = await requireAuth(req);
    userId = auth.userId;
  } catch (err: any) {
    const msg = err?.message ?? 'Não autenticado';
    if (msg.includes('autenticado') || msg.includes('inválido')) {
      return errorResponse(msg, 401);
    }
    console.error('[upload-media] requireAuth:', msg);
    return errorResponse('Não autenticado', 401);
  }

  try {
    const formData = await req.formData().catch(() => null);
    if (!formData) return errorResponse('FormData inválido', 400);

    const file = formData.get('file') as File | null;
    const config_id = formData.get('config_id') as string | null;
    if (!file || !file.size) return errorResponse('Arquivo obrigatório', 400);
    if (!config_id || typeof config_id !== 'string') return errorResponse('config_id obrigatório', 400);

    const safeName = (file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    let mimeType = (file.type || '').split(';')[0].trim().toLowerCase();
    if (!mimeType || mimeType === 'application/octet-stream') {
      mimeType = inferMimeFromFileName(safeName) || mimeType || 'application/octet-stream';
    }
    const mediaType = inferMediaType(mimeType, safeName);
    const maxSize = getMaxSize(mediaType);
    if (file.size > maxSize) {
      return errorResponse(`Arquivo muito grande. Máximo para ${mediaType}: ${maxSize / 1024 / 1024}MB`, 400);
    }

    const allowedByType: Record<string, readonly string[]> = {
      image: ALLOWED_IMAGE,
      audio: ALLOWED_AUDIO,
      video: ALLOWED_VIDEO,
      document: ALLOWED_DOCUMENT,
    };
    const allowed = allowedByType[mediaType];
    if (!allowed?.includes(mimeType)) {
      const fromName = inferMimeFromFileName(safeName);
      if (fromName && allowed?.includes(fromName)) {
        mimeType = fromName;
      } else {
        return errorResponse(`Tipo de arquivo não permitido para ${mediaType}: ${mimeType}`, 400);
      }
    }

    const { data: config, error: configError } = await supabaseServiceRole
      .from('whatsapp_official_configs')
      .select('id, zaploto_id')
      .eq('id', config_id)
      .eq('is_active', true)
      .single();

    if (configError || !config) return errorResponse('Configuração não encontrada ou inativa', 404);

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status, zaploto_id')
      .eq('id', userId)
      .single();

    const status = String(profile?.status || '').toLowerCase();
    const isAdminOrSuporte = status === 'super_admin' || status === 'admin' || status === 'suporte';
    if (!isAdminOrSuporte && profile?.zaploto_id !== config.zaploto_id) {
      return errorResponse('Acesso negado a esta configuração', 403);
    }

    const timestamp = Date.now();
    const storagePath = `uploads/${config_id}/${timestamp}-${safeName}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await supabaseServiceRole.storage
      .from(CHAT_MEDIA_BUCKET)
      .upload(storagePath, buffer, { contentType: mimeType, upsert: true });

    if (uploadError) {
      console.error('[Zaploto Chat] upload-media storage error:', uploadError.message, 'path:', storagePath);
      return errorResponse(`Falha no upload. Verifique permissões do bucket e tamanho do arquivo.`, 500);
    }

    const { data: urlData } = supabaseServiceRole.storage
      .from(CHAT_MEDIA_BUCKET)
      .getPublicUrl(storagePath);

    return successResponse({
      url: urlData.publicUrl,
      media_type: mediaType,
      mime_type: mimeType,
    });
  } catch (err: any) {
    console.error('[Zaploto Chat] upload-media exception:', err?.message ?? err);
    return serverErrorResponse(err as Error);
  }
}
