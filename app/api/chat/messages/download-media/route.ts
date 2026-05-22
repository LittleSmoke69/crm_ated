/**
 * GET /api/chat/messages/download-media?chat_message_id=...
 * Proxy autenticado para baixar/visualizar mídia do chat com Content-Type e nome de arquivo corretos.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import {
  contentTypeForDocumentKind,
  documentDisplayName,
  inferDocumentFileKind,
  inferMimeFromFileName,
  isPdfBytes,
  suggestedDownloadName,
} from '@/lib/chat/document-file-utils';

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);

    const chatMessageId = req.nextUrl.searchParams.get('chat_message_id');
    if (!chatMessageId) {
      return errorResponse('chat_message_id é obrigatório', 400);
    }

    const download = req.nextUrl.searchParams.get('download') === '1';
    const inline = req.nextUrl.searchParams.get('inline') === '1' || !download;

    const { data: chatMsg, error: msgErr } = await supabaseServiceRole
      .from('chat_messages')
      .select('id, media_url, media_type, caption')
      .eq('id', chatMessageId)
      .single();

    if (msgErr || !chatMsg?.media_url) {
      return errorResponse('Mídia não encontrada', 404);
    }

    const mediaUrl = String(chatMsg.media_url);
    const upstream = await fetch(mediaUrl);
    if (!upstream.ok) {
      return errorResponse(`Falha ao obter arquivo: HTTP ${upstream.status}`, 502);
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    const caption = chatMsg.caption as string | null | undefined;
    const fileName = suggestedDownloadName(
      caption,
      mediaUrl,
      chatMsg.media_type === 'document'
        ? inferDocumentFileKind(mediaUrl, caption)
        : 'other'
    );

    let contentType =
      upstream.headers.get('content-type')?.split(';')[0].trim() || 'application/octet-stream';

    if (isPdfBytes(buffer)) {
      contentType = 'application/pdf';
    } else if (contentType === 'application/octet-stream' && chatMsg.media_type === 'document') {
      const fromName = inferMimeFromFileName(fileName);
      if (fromName) {
        contentType = fromName;
      } else {
        const kind = inferDocumentFileKind(mediaUrl, caption);
        contentType = contentTypeForDocumentKind(kind);
      }
    }

    const disposition = download
      ? `attachment; filename="${encodeURIComponent(fileName)}"`
      : `inline; filename="${encodeURIComponent(documentDisplayName(caption, mediaUrl))}"`;

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': inline && chatMsg.media_type === 'document' && contentType === 'text/plain'
          ? 'text/plain; charset=utf-8'
          : contentType,
        'Content-Disposition': disposition,
        'Content-Length': String(buffer.length),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    return serverErrorResponse(err as Error);
  }
}
