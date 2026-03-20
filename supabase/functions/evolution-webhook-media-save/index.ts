import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CHAT_MEDIA_BUCKET = 'chat-media';

type ReqBody = {
  sourceUrl?: string;
  sourceBase64?: string;
  mimeType?: string;
  instanceName?: string;
  messageId?: string;
  mediaType?: string;
};

function extFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/webm': 'webm',
    'video/mp4': 'mp4',
    'application/pdf': 'pdf',
  };
  return map[mimeType.toLowerCase()] || 'bin';
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseDataUrl(dataUrl: string): { mimeType: string; bytes: Uint8Array } | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl || '');
  if (!match) return null;
  return {
    mimeType: match[1] || 'application/octet-stream',
    bytes: decodeBase64(match[2] || ''),
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'Supabase env not configured' }), { status: 500 });
    }

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const sourceUrl = String(body.sourceUrl || '').trim();
    const sourceBase64 = String(body.sourceBase64 || '').trim();
    let mimeType = String(body.mimeType || 'application/octet-stream').trim();
    const instanceName = String(body.instanceName || 'unknown').trim().replace(/[^\w.-]/g, '_');
    const messageId = String(body.messageId || Date.now()).trim().replace(/[^\w.-]/g, '_');
    const mediaType = String(body.mediaType || 'media').trim().replace(/[^\w.-]/g, '_');

    if (!sourceUrl && !sourceBase64) {
      return new Response(JSON.stringify({ error: 'sourceUrl or sourceBase64 is required' }), { status: 400 });
    }

    let bytes: Uint8Array | null = null;

    if (sourceBase64) {
      bytes = decodeBase64(sourceBase64);
    } else if (sourceUrl.startsWith('data:')) {
      const parsed = parseDataUrl(sourceUrl);
      if (!parsed) return new Response(JSON.stringify({ error: 'Invalid data url' }), { status: 400 });
      mimeType = parsed.mimeType || mimeType;
      bytes = parsed.bytes;
    } else {
      const mediaResponse = await fetch(sourceUrl);
      if (!mediaResponse.ok) {
        return new Response(JSON.stringify({ error: `Failed to fetch media: ${mediaResponse.status}` }), { status: 502 });
      }
      const contentType = mediaResponse.headers.get('content-type') || '';
      if (contentType) mimeType = contentType.split(';')[0].trim();
      bytes = new Uint8Array(await mediaResponse.arrayBuffer());
    }

    if (!bytes || bytes.length === 0) {
      return new Response(JSON.stringify({ error: 'Empty media content' }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const extension = extFromMime(mimeType);
    const path = `${instanceName}/${mediaType}/${messageId}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(CHAT_MEDIA_BUCKET)
      .upload(path, bytes, {
        contentType: mimeType,
        upsert: true,
      });

    if (uploadError) {
      return new Response(JSON.stringify({ error: uploadError.message }), { status: 500 });
    }

    const { data } = supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path);
    return new Response(JSON.stringify({ publicUrl: data.publicUrl, path, mimeType }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});

