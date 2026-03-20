/**
 * POST /api/admin/flows/[flowId]/upload-media
 * Upload de mídia (imagem, áudio, vídeo) para nós de envio do flow.
 * Armazena no bucket campaign-media e retorna URL assinada (1 ano) para uso no config.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const BUCKET = 'campaign-media';

const ALLOWED: Record<string, string[]> = {
  image: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
  video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
  audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm'],
};

const MAX_MB = { image: 100, video: 100, audio: 100 };

function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogv', 'video/quicktime': 'mov',
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/webm': 'webm',
  };
  return map[mime?.toLowerCase()] ?? 'bin';
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ flowId: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { flowId } = await params;

    if (!flowId || flowId === 'new') {
      return errorResponse('Salve o flow antes de enviar mídia', 400);
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const typeParam = (formData.get('type') as string)?.toLowerCase();

    if (!file || !typeParam) {
      return errorResponse('Envie formData com file e type (image, video ou audio)', 400);
    }
    if (!['image', 'video', 'audio'].includes(typeParam)) {
      return errorResponse('type deve ser image, video ou audio', 400);
    }

    const mime = file.type || 'application/octet-stream';
    const allowedMimes = ALLOWED[typeParam];
    if (!allowedMimes.includes(mime)) {
      return errorResponse(`Tipo de arquivo não permitido para ${typeParam}. Aceitos: ${allowedMimes.join(', ')}`, 400);
    }

    const maxBytes = MAX_MB[typeParam as keyof typeof MAX_MB] * 1024 * 1024;
    if (file.size > maxBytes) {
      return errorResponse(`Arquivo muito grande. Máximo ${MAX_MB[typeParam as keyof typeof MAX_MB]}MB para ${typeParam}`, 400);
    }

    const { data: flow, error: flowError } = await supabaseServiceRole
      .from('flows')
      .select('id')
      .eq('id', flowId)
      .eq('user_id', userId)
      .single();

    if (flowError || !flow) {
      return errorResponse('Flow não encontrado ou sem permissão', 404);
    }

    const ext = extFromMime(mime);
    const storagePath = `flows/${flowId}/${typeParam}/${uuid()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: upErr } = await supabaseServiceRole.storage
      .from(BUCKET)
      .upload(storagePath, buffer, { contentType: mime, upsert: true });

    if (upErr) {
      console.error('[flows/upload-media] Storage error:', upErr);
      return errorResponse('Erro ao salvar no Storage: ' + upErr.message, 500);
    }

    const { data: signedUrlData, error: signedUrlError } = await supabaseServiceRole
      .storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 31536000); // 1 ano

    if (signedUrlError || !signedUrlData?.signedUrl) {
      console.error('[flows/upload-media] Signed URL error:', signedUrlError);
      return serverErrorResponse('Erro ao gerar URL da mídia');
    }

    return successResponse({
      url: signedUrlData.signedUrl,
      path: storagePath,
    });
  } catch (err: unknown) {
    const e = err as Error;
    console.error('[flows/upload-media]', e);
    return serverErrorResponse(e?.message || 'Erro inesperado no upload');
  }
}
