/**
 * Metadados do body Evolution `sendMedia` — mesmo contrato do disparo em massa (grupos).
 * @see lib/crm/mass-send-process-core.ts sendGroupToEvolution
 */
export type EvolutionSendMediaMetaInput = {
  attachment_url?: string | null;
  attachment_type?: string | null;
  attachment_mime?: string | null;
};

export function resolveEvolutionSendMediaMeta(message: EvolutionSendMediaMetaInput): {
  mediatype: string;
  mimetype: string;
  fileName: string;
} {
  const mime = message.attachment_mime || 'image/png';
  if (message.attachment_type === 'video')
    return { mediatype: 'video', mimetype: message.attachment_mime || 'video/mp4', fileName: 'video.mp4' };
  if (message.attachment_type === 'audio')
    return { mediatype: 'document', mimetype: message.attachment_mime || 'audio/mpeg', fileName: 'audio.mp3' };
  if (message.attachment_type === 'image') {
    const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('gif') ? 'gif' : 'png';
    return { mediatype: 'image', mimetype: mime, fileName: `image.${ext}` };
  }
  const url = String(message.attachment_url || '').toLowerCase();
  if (url.match(/\.(mp4|mov|avi|webm)/) || mime.startsWith('video/'))
    return { mediatype: 'video', mimetype: mime || 'video/mp4', fileName: 'video.mp4' };
  if (url.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt)/) || mime.startsWith('application/'))
    return { mediatype: 'document', mimetype: mime || 'application/pdf', fileName: 'file' };
  const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('gif') ? 'gif' : 'png';
  return { mediatype: 'image', mimetype: mime, fileName: `image.${ext}` };
}

/**
 * Corrige mediatype/mimetype quando o passo foi salvo como `image` mas a URL ou o MIME
 * indicam vídeo ou PDF. Evita na Evolution o erro "Input buffer contains unsupported image format"
 * ao tentar decodificar MP4 como imagem (ex.: disparo em massa com template CRM `text_with_attachment`).
 */
export function coerceEvolutionSendMediaFields(params: {
  mediatype?: string | null;
  mimetype?: string | null;
  fileName?: string | null;
  mediaUrl?: string | null;
}): { mediatype: string; mimetype: string; fileName?: string | null } {
  const url = String(params.mediaUrl || '').toLowerCase();
  const mimeLower = String(params.mimetype || '').toLowerCase();
  let mediatype = String(params.mediatype || 'image').toLowerCase();
  let mimetype = params.mimetype || undefined;
  let fileName = params.fileName ?? undefined;

  const urlLooksVideo = /\.(mp4|mov|avi|webm|m4v|mkv)(\?|#|&|$)/i.test(url);
  const urlLooksPdf = /\.pdf(\?|#|&|$)/i.test(url);
  const mimeIsVideo = mimeLower.startsWith('video/');
  const mimeIsImage = mimeLower.startsWith('image/');

  if (mediatype === 'image' && (mimeIsVideo || urlLooksVideo)) {
    mediatype = 'video';
    mimetype = mimeIsVideo ? (params.mimetype ?? 'video/mp4') : 'video/mp4';
    if (!fileName || !/\.(mp4|mov|webm|m4v)$/i.test(String(fileName))) fileName = 'video.mp4';
  }

  if (mediatype === 'image' && (mimeLower === 'application/pdf' || urlLooksPdf)) {
    mediatype = 'document';
    mimetype = params.mimetype || 'application/pdf';
    if (!fileName || !/\.pdf$/i.test(String(fileName))) fileName = 'document.pdf';
  }

  if (mediatype === 'video' && (!mimetype || !String(mimetype).toLowerCase().startsWith('video/'))) {
    mimetype = /\.webm(\?|$)/i.test(url) ? 'video/webm' : /\.mov(\?|$)/i.test(url) ? 'video/quicktime' : 'video/mp4';
    if (!fileName || !/\.(mp4|mov|webm|m4v)$/i.test(String(fileName))) fileName = 'video.mp4';
  }

  if (mediatype === 'document' && !mimetype) mimetype = 'application/pdf';

  if (mediatype === 'image' && (!mimetype || !mimeIsImage)) {
    mimetype = /\.png(\?|$)/i.test(url) ? 'image/png' : /\.gif(\?|$)/i.test(url) ? 'image/gif' : 'image/jpeg';
  }

  return { mediatype, mimetype: mimetype || 'image/jpeg', fileName };
}
