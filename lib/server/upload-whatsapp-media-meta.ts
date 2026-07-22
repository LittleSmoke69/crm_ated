const GRAPH_BASE = 'https://graph.facebook.com';
const UPLOAD_TIMEOUT_MS = 2 * 60_000;

export type WhatsAppMediaUploadConfig = {
  phone_number_id: string;
  graph_version: string;
  access_token: string;
};

export async function uploadMediaBufferToMeta(
  config: WhatsAppMediaUploadConfig,
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<string> {
  const version = String(config.graph_version || 'v25.0').replace(/^v/, '');
  const uploadUrl = `${GRAPH_BASE}/v${version}/${config.phone_number_id}/media`;

  const metaFormData = new FormData();
  metaFormData.append('messaging_product', 'whatsapp');
  metaFormData.append('type', mimeType);
  metaFormData.append('file', new Blob([Uint8Array.from(buffer).buffer], { type: mimeType }), fileName);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

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

  const metaJson = (await metaRes.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string; error_data?: { details?: string } };
  };

  if (!metaRes.ok || !metaJson.id) {
    throw new Error(
      metaJson?.error?.error_data?.details ||
        metaJson?.error?.message ||
        `Falha no upload para Meta: HTTP ${metaRes.status}`
    );
  }

  return metaJson.id;
}
