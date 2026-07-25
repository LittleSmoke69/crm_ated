/**
 * GET /api/email/track/click?id=<email_log_id>&url=<destino>&t=<token>
 * Link rastreado de e-mail: registra o clique e redireciona para o destino original.
 * O token HMAC amarra (id, url) — sem token válido não há redirecionamento externo
 * (evita uso como open redirect). Rota pública.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { APP_BASE, isValidClickToken } from '@/lib/services/email-tracking';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const id = params.get('id') || '';
  const url = params.get('url') || '';
  const token = params.get('t') || '';

  const valid = UUID_RE.test(id) && /^https?:\/\//i.test(url) && Boolean(token) && isValidClickToken(id, url, token);
  if (!valid) {
    return NextResponse.redirect(APP_BASE(), 302);
  }

  try {
    const { error } = await supabaseServiceRole.rpc('register_email_click', { log_id: id, clicked_url: url });
    if (error) console.error('[email-track] click:', error.message);
  } catch (err) {
    console.error('[email-track] click:', err);
  }
  return NextResponse.redirect(url, 302);
}
