/**
 * POST /api/chat/whatsapp-official/upload-audio-meta
 * Converte áudio do browser (mp4/webm/ogg) para OGG/OPUS quando necessário e envia à Meta.
 * Retorna { media_id } para uso em send com audio: { id: media_id }.
 */

import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile, unlink, readFile } from 'fs/promises';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import {
  convertAudioFileToOggOpus,
  isValidWhatsAppOggOpusBuffer,
  WHATSAPP_AUDIO_MAX_BYTES,
  WHATSAPP_AUDIO_META_UPLOAD_TYPE,
  WHATSAPP_VOICE_PLAY_ICON_MAX_BYTES,
} from '@/lib/server/convert-audio-to-ogg-opus';
import { resolveFfmpegPath } from '@/lib/server/resolve-ffmpeg-path';
import {
  mimeForMetaUpload,
  uploadAudioBufferToMeta,
} from '@/lib/server/upload-whatsapp-audio-meta';

const OUTPUT_EXT = 'ogg';

export async function POST(req: NextRequest) {
  let userId: string | undefined;
  try {
    const auth = await requireAuth(req);
    userId = auth.userId;
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? 'Não autenticado';
    return errorResponse(msg.includes('autenticado') || msg.includes('inválido') ? msg : 'Não autenticado', 401);
  }

  const id = randomUUID();
  const inputPath = join(tmpdir(), `audio-in-${id}`);
  const outputPath = join(tmpdir(), `audio-out-${id}.${OUTPUT_EXT}`);

  try {
    const formData = await req.formData().catch(() => null);
    if (!formData) return errorResponse('FormData inválido', 400);

    const file = formData.get('file') as File | null;
    const config_id = formData.get('config_id') as string | null;

    if (!file || !file.size) return errorResponse('Arquivo obrigatório', 400);
    if (file.size > WHATSAPP_AUDIO_MAX_BYTES) {
      return errorResponse('Áudio muito grande. Máximo permitido pela Meta: 16 MB.', 400);
    }
    if (!config_id) return errorResponse('config_id obrigatório', 400);

    const { data: config, error: configError } = await supabaseServiceRole
      .from('whatsapp_official_configs')
      .select('id, phone_number_id, graph_version, access_token, zaploto_id')
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

    const rawMime = (file.type || 'audio/ogg').split(';')[0].trim().toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());

    const ffmpegPath = resolveFfmpegPath();
    console.info('[upload-audio-meta] start', {
      phone_number_id: config.phone_number_id,
      source_mime: rawMime,
      file_size: file.size,
      ffmpeg: ffmpegPath ?? 'unavailable',
      cwd: process.cwd(),
    });

    if (!ffmpegPath) {
      return errorResponse(
        'FFmpeg (dependência ffmpeg-static) não foi encontrado no servidor. Execute npm install na pasta do app e reinicie o Next.js.',
        503
      );
    }

    // Sempre normalizar via FFmpeg: OGG do browser costuma falhar na Meta (#131053 octet-stream).
    await writeFile(inputPath, buffer);
    let uploadBuffer: Buffer;
    let converted = true;
    try {
      await convertAudioFileToOggOpus(inputPath, outputPath);
      uploadBuffer = await readFile(outputPath);
    } catch (ffErr) {
      const msg = (ffErr as Error).message || 'Falha na conversão';
      console.error('[upload-audio-meta] conversion failed:', msg);
      const isMissingFfmpeg = msg.includes('FFmpeg não encontrado');
      return errorResponse(
        isMissingFfmpeg
          ? 'FFmpeg não está instalado no servidor. No Mac: brew install ffmpeg. Em produção, inclua ffmpeg na imagem Docker ou defina FFMPEG_PATH no .env.'
          : `Falha na conversão do áudio (${rawMime}). Tente gravar novamente ou use outro navegador.`,
        isMissingFfmpeg ? 503 : 422
      );
    }

    if (!isValidWhatsAppOggOpusBuffer(uploadBuffer)) {
      return errorResponse('Conversão gerou arquivo inválido. Tente gravar a nota de voz novamente.', 422);
    }

    const metaMime = mimeForMetaUpload(rawMime, converted);
    const mediaId = await uploadAudioBufferToMeta(
      {
        phone_number_id: config.phone_number_id,
        graph_version: config.graph_version,
        access_token: config.access_token,
      },
      uploadBuffer,
      metaMime,
      `audio.${OUTPUT_EXT}`
    );

    if (converted && uploadBuffer.length > WHATSAPP_VOICE_PLAY_ICON_MAX_BYTES) {
      console.warn(
        `[upload-audio-meta] áudio > 512KB (${uploadBuffer.length} bytes): Meta entrega, mas pode exibir ícone de download em vez de play`
      );
    }

    console.info('[upload-audio-meta] ok', {
      media_id: mediaId,
      converted,
      upload_size: uploadBuffer.length,
      meta_mime: metaMime,
      voice_note: true,
    });

    return successResponse({
      media_id: mediaId,
      media_type: 'audio',
      mime_type: metaMime,
    });
  } catch (err: unknown) {
    console.error('[upload-audio-meta] exception:', (err as Error)?.message ?? err);
    return serverErrorResponse(err as Error);
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}
