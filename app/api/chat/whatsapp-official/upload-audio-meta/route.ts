/**
 * POST /api/chat/whatsapp-official/upload-audio-meta
 * Faz upload de áudio DIRETAMENTE para os servidores da Meta (WhatsApp Cloud API).
 * Retorna { media_id } que é usado no envio com audio: { id: media_id }
 * em vez de audio: { link: url }, garantindo entrega correta independente do formato do container.
 *
 * Formatos aceitos pela Meta no upload: audio/ogg, audio/mpeg, audio/aac, audio/mp4, audio/amr
 * Para áudio gravado em audio/webm (Chrome), tentamos como audio/ogg pois o codec Opus é compatível.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const GRAPH_BASE = 'https://graph.facebook.com';

// Mapeia MIME types do browser para MIME aceito pela Meta
function normalizeMimeForMeta(mimeType: string): string {
  const m = mimeType.toLowerCase().split(';')[0].trim();
  // WebM com Opus → envia como OGG Opus (formato aceito pela Meta)
  if (m === 'audio/webm') return 'audio/ogg; codecs=opus';
  if (m === 'audio/ogg') return 'audio/ogg; codecs=opus';
  if (m === 'audio/x-m4a') return 'audio/mp4';
  if (m === 'audio/m4a') return 'audio/mp4';
  return m;
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
    const metaMime = normalizeMimeForMeta(rawMime);
    const ext = metaMime === 'audio/ogg' ? 'ogg'
      : metaMime === 'audio/mpeg' ? 'mp3'
      : metaMime === 'audio/mp4' ? 'm4a'
      : metaMime === 'audio/aac' ? 'aac'
      : metaMime === 'audio/amr' ? 'amr'
      : 'ogg';

    const version = String(config.graph_version || 'v25.0').replace(/^v/, '');
    const uploadUrl = `${GRAPH_BASE}/v${version}/${config.phone_number_id}/media`;

    // Monta multipart para a Meta — reutiliza o blob com MIME normalizado
    const buffer = await file.arrayBuffer();
    const metaFormData = new FormData();
    metaFormData.append('messaging_product', 'whatsapp');
    metaFormData.append('type', metaMime);
    metaFormData.append(
      'file',
      new Blob([buffer], { type: metaMime }),
      `audio.${ext}`
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    console.info('[upload-audio-meta] upload request', {
      phone_number_id: config.phone_number_id,
      graph_version: `v${version}`,
      source_mime: rawMime,
      normalized_mime: metaMime,
      file_size: file.size,
    });

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
      mime_type: metaMime,
    });
  } catch (err: unknown) {
    console.error('[upload-audio-meta] exception:', (err as Error)?.message ?? err);
    return serverErrorResponse(err as Error);
  }
}
