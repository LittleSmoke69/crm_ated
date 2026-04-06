/**
 * Extrai texto e chave de mensagem de payloads Evolution (messages.upsert / MESSAGES_UPSERT).
 */

/** Desembrulha ephemeral / view-once para ler conversation ou mídia interna. */
function unwrapMessageNode(msg: Record<string, unknown>): Record<string, unknown> {
  let current = msg;
  for (let depth = 0; depth < 6; depth++) {
    const ep = current.ephemeralMessage as Record<string, unknown> | undefined;
    if (ep && typeof ep.message === 'object' && ep.message !== null) {
      current = ep.message as Record<string, unknown>;
      continue;
    }
    const vo =
      (current.viewOnceMessage as Record<string, unknown> | undefined) ||
      (current.viewOnceMessageV2 as Record<string, unknown> | undefined);
    if (vo && typeof vo.message === 'object' && vo.message !== null) {
      current = vo.message as Record<string, unknown>;
      continue;
    }
    break;
  }
  return current;
}

function getMessageObject(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const data = (p.data as Record<string, unknown>) ?? p;
  const msg = (data.message as Record<string, unknown>) ?? (p.message as Record<string, unknown>);
  if (!msg || typeof msg !== 'object') return null;
  return unwrapMessageNode(msg);
}

/** Texto “útil” para match de palavras-chave (só texto/caption). */
export function extractMessageBodyText(payload: unknown): string {
  const msg = getMessageObject(payload);
  if (!msg) return '';
  const parts: string[] = [];

  const c = msg.conversation;
  if (typeof c === 'string' && c.trim()) parts.push(c.trim());

  const et = msg.extendedTextMessage as Record<string, unknown> | undefined;
  if (et && typeof et.text === 'string' && et.text.trim()) parts.push(et.text.trim());

  for (const t of ['imageMessage', 'videoMessage', 'documentMessage'] as const) {
    const m = msg[t] as Record<string, unknown> | undefined;
    if (m && typeof m.caption === 'string' && m.caption.trim()) parts.push(m.caption.trim());
  }

  return parts.join(' ').trim();
}

const NON_TEXT_KIND_LABELS: Record<string, string> = {
  imageMessage: '[Imagem sem legenda]',
  videoMessage: '[Vídeo sem legenda]',
  audioMessage: '[Áudio]',
  pttMessage: '[Áudio (PTT)]',
  stickerMessage: '[Figurinha]',
  documentMessage: '[Documento sem legenda]',
  locationMessage: '[Localização]',
  liveLocationMessage: '[Localização ao vivo]',
  contactMessage: '[Contato]',
  contactsArrayMessage: '[Contatos]',
  reactionMessage: '[Reação]',
  pollCreationMessage: '[Enquete]',
  pollUpdateMessage: '[Voto em enquete]',
  viewOnceMessage: '[Ver uma vez]',
  ephemeralMessage: '[Mensagem temporária]',
  buttonsMessage: '[Botões]',
  listMessage: '[Lista]',
  templateMessage: '[Modelo]',
  buttonsResponseMessage: '[Resposta a botões]',
  listResponseMessage: '[Resposta a lista]',
};

/**
 * Prévia para UI: texto quando existir; senão rótulo do tipo (figurinha, áudio, etc.).
 * Mensagens só com texto vazio em campos não mapeados podem continuar com "—".
 */
export function extractMessagePreview(payload: unknown, maxLen = 400): string {
  const text = extractMessageBodyText(payload);
  if (text) return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;

  const msg = getMessageObject(payload);
  if (!msg) return '';

  for (const [key, label] of Object.entries(NON_TEXT_KIND_LABELS)) {
    if (msg[key] != null) return label;
  }

  const dynamic = Object.keys(msg).find(
    (k) => k.endsWith('Message') && k !== 'messageContextInfo' && !(k in NON_TEXT_KIND_LABELS)
  );
  if (dynamic) {
    const short = dynamic.replace(/Message$/, '');
    return `[${short}]`;
  }

  return '';
}

export interface EvolutionMessageKey {
  id: string;
  remoteJid: string;
  fromMe: boolean;
  participant: string;
}

export function extractMessageKey(payload: unknown): EvolutionMessageKey | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const data = (p.data as Record<string, unknown>) ?? p;
  const key = (data.key as Record<string, unknown>) ?? (p.key as Record<string, unknown>);
  if (!key) return null;
  const id = key.id != null ? String(key.id) : '';
  const remoteJid = key.remoteJid != null ? String(key.remoteJid) : '';
  if (!id || !remoteJid) return null;
  const fromMe = key.fromMe === true || key.fromMe === 'true';
  const participant = key.participant != null ? String(key.participant) : '';
  return { id, remoteJid, fromMe, participant };
}
