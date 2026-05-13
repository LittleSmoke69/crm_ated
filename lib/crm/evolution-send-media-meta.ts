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
