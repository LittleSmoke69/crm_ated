/**
 * Teste manual de áudio para WhatsApp Cloud API (oficial)
 *
 * Uso:
 *   WA_TOKEN=... \
 *   WA_PHONE_NUMBER_ID=... \
 *   WA_TO=55819... \
 *   WA_AUDIO_FILE=/abs/path/audio.ogg \
 *   WA_AUDIO_MIME="audio/ogg; codecs=opus" \
 *   npm run test:wa-audio-official
 */

import fs from 'node:fs/promises';

const GRAPH_BASE = 'https://graph.facebook.com';
const GRAPH_VERSION = process.env.WA_GRAPH_VERSION || 'v25.0';
const TOKEN = process.env.WA_TOKEN || '';
const PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID || '';
const TO = (process.env.WA_TO || '').replace(/\D/g, '');
const AUDIO_FILE = process.env.WA_AUDIO_FILE || '';
const AUDIO_MIME = process.env.WA_AUDIO_MIME || 'audio/ogg; codecs=opus';

function ensureEnv(name: string, value: string) {
  if (!value) {
    throw new Error(`Variável obrigatória ausente: ${name}`);
  }
}

async function uploadAudio(): Promise<string> {
  const bytes = await fs.readFile(AUDIO_FILE);
  const formData = new FormData();
  formData.append('messaging_product', 'whatsapp');
  formData.append('type', AUDIO_MIME);
  formData.append('file', new Blob([bytes], { type: AUDIO_MIME }), 'audio-test.ogg');

  const url = `${GRAPH_BASE}/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/media`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: formData,
  });
  const bodyText = await res.text();
  let json: unknown = null;
  try { json = bodyText ? JSON.parse(bodyText) : null; } catch { json = bodyText; }

  console.log('[upload] status:', res.status);
  console.log('[upload] body:', json);

  if (!res.ok) throw new Error(`Upload falhou: ${res.status}`);
  const mediaId = (json as { id?: string })?.id;
  if (!mediaId) throw new Error('Upload sem media_id no retorno');
  return mediaId;
}

async function sendAudio(mediaId: string): Promise<void> {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: TO,
    type: 'audio',
    audio: { id: mediaId },
  };

  const url = `${GRAPH_BASE}/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const bodyText = await res.text();
  let json: unknown = null;
  try { json = bodyText ? JSON.parse(bodyText) : null; } catch { json = bodyText; }

  console.log('[sendAudio] status:', res.status);
  console.log('[sendAudio] payload:', payload);
  console.log('[sendAudio] body:', json);

  if (!res.ok) throw new Error(`Envio falhou: ${res.status}`);
}

async function main() {
  ensureEnv('WA_TOKEN', TOKEN);
  ensureEnv('WA_PHONE_NUMBER_ID', PHONE_NUMBER_ID);
  ensureEnv('WA_TO', TO);
  ensureEnv('WA_AUDIO_FILE', AUDIO_FILE);

  console.log('Iniciando teste de áudio oficial...');
  console.log({ GRAPH_VERSION, PHONE_NUMBER_ID, TO, AUDIO_FILE, AUDIO_MIME });

  const mediaId = await uploadAudio();
  console.log('media_id:', mediaId);
  await sendAudio(mediaId);
  console.log('Teste concluído com sucesso.');
}

main().catch((err) => {
  console.error('[test:wa-audio-official] erro:', err instanceof Error ? err.message : err);
  process.exit(1);
});

