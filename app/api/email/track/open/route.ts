/**
 * GET /api/email/track/open?id=<email_log_id>
 * Pixel de abertura de e-mail: registra a abertura e devolve um GIF 1x1 transparente.
 * Rota pública (é carregada pelo cliente de e-mail do destinatário).
 */
import { NextRequest } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (UUID_RE.test(id)) {
    try {
      const { error } = await supabaseServiceRole.rpc('register_email_open', { log_id: id });
      if (error) console.error('[email-track] open:', error.message);
    } catch (err) {
      console.error('[email-track] open:', err);
    }
  }
  return new Response(new Uint8Array(TRANSPARENT_GIF), {
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(TRANSPARENT_GIF.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    },
  });
}
