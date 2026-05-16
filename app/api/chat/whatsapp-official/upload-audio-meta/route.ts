/**
 * POST /api/chat/whatsapp-official/upload-audio-meta
 * Converte qualquer áudio do browser (mp4/webm/ogg) para OGG/OPUS via FFmpeg
 * e faz upload diretamente para os servidores da Meta (WhatsApp Cloud API).
 *
 * Por que converter:
 *  - iOS grava audio/mp4 (fMP4 fragmentado) que o WhatsApp não consegue decodificar.
 *  - Chrome grava audio/webm que não é OGG — renomear o MIME sem converter não funciona.
 *  - OGG/OPUS é o único formato garantido para entrega de áudio pelo WhatsApp.
 *
 * Retorna { media_id } para uso no envio via audio: { id: media_id }.
 */

import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile, unlink, readFile } from 'fs/promises';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { execSync } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';

// Prefere o FFmpeg do sistema (Docker/prod com apk add ffmpeg).
// Fallback para o binário empacotado pelo ffmpeg-static (desenvolvimento local).
const systemFfmpeg = (() => {
  try { return execSync('which ffmpeg', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; }
})();
ffmpeg.setFfmpegPath(systemFfmpeg || ffmpegStatic || 'ffmpeg');

const GRAPH_BASE = 'https://graph.facebook.com';
const OUTPUT_MIME = 'audio/ogg; codecs=opus';
const OUTPUT_EXT = 'ogg';

/** Converte qualquer buffer de áudio para OGG/OPUS via FFmpeg. */
function convertToOggOpus(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioCodec('libopus')
      .audioFrequency(16000)   // 16kHz — ideal para voz no WhatsApp
      .audioChannels(1)         // mono obrigatório
      .audioBitrate('32k')      // 32kbps mantém o arquivo abaixo de 512KB
      .format('ogg')
      .on('error', (err) => reject(new Error(`FFmpeg: ${err.message}`)))
      .on('end', () => resolve())
      .save(outputPath);
  });
}

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
    if (!config_id) return errorResponse('config_id obrigatório', 400);

    // Busca config WA Oficial
    const { data: config, error: configError } = await supabaseServiceRole
      .from('whatsapp_official_configs')
      .select('id, phone_number_id, graph_version, access_token, zaploto_id')
      .eq('id', config_id)
      .eq('is_active', true)
      .single();

    if (configError || !config) return errorResponse('Configuração não encontrada ou inativa', 404);

    // Verifica acesso
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

    console.info('[upload-audio-meta] converting audio', {
      phone_number_id: config.phone_number_id,
      source_mime: rawMime,
      file_size: file.size,
    });

    // Escreve o arquivo recebido em /tmp
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(inputPath, buffer);

    // Converte para OGG/OPUS via FFmpeg
    try {
      await convertToOggOpus(inputPath, outputPath);
    } catch (ffErr) {
      console.error('[upload-audio-meta] FFmpeg conversion failed:', (ffErr as Error).message);
      return errorResponse('Falha na conversão do áudio. Verifique o formato do arquivo.', 422);
    }

    // Lê o arquivo convertido
    const convertedBuffer = await readFile(outputPath);

    console.info('[upload-audio-meta] conversion done', {
      original_size: file.size,
      converted_size: convertedBuffer.length,
      output_mime: OUTPUT_MIME,
    });

    // Upload para a Meta
    const version = String(config.graph_version || 'v25.0').replace(/^v/, '');
    const uploadUrl = `${GRAPH_BASE}/v${version}/${config.phone_number_id}/media`;

    const metaFormData = new FormData();
    metaFormData.append('messaging_product', 'whatsapp');
    metaFormData.append('type', OUTPUT_MIME);
    metaFormData.append(
      'file',
      new Blob([convertedBuffer], { type: OUTPUT_MIME }),
      `audio.${OUTPUT_EXT}`
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    let metaRes: Response;
    try {
      metaRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.access_token}` },
        body: metaFormData,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const metaJson = await metaRes.json().catch(() => ({}));
    console.info('[upload-audio-meta] upload response', {
      status: metaRes.status,
      ok: metaRes.ok,
      body: metaJson,
    });

    if (!metaRes.ok || !metaJson.id) {
      console.error('[upload-audio-meta] Meta error:', metaRes.status, JSON.stringify(metaJson));
      return errorResponse(
        metaJson?.error?.message || `Falha no upload para Meta: HTTP ${metaRes.status}`,
        502
      );
    }

    return successResponse({
      media_id: metaJson.id as string,
      media_type: 'audio',
      mime_type: OUTPUT_MIME,
    });
  } catch (err: unknown) {
    console.error('[upload-audio-meta] exception:', (err as Error)?.message ?? err);
    return serverErrorResponse(err as Error);
  } finally {
    // Limpa sempre os arquivos temporários
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}
