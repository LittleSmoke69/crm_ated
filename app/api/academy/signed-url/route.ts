import { NextRequest, NextResponse } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const BUCKET = 'academy-assets';

/**
 * GET /api/academy/signed-url?path=xxx
 * Retorna signed URL para download (expira em 1h).
 * Header: x-user-id (opcional; se não logado, pode negar para arquivos sensíveis).
 */
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get('path');
  if (!path) {
    return NextResponse.json({ error: 'path obrigatório' }, { status: 400 });
  }
  try {
    const { data, error } = await supabaseServiceRole.storage
      .from(BUCKET)
      .createSignedUrl(path, 3600);

    if (error) {
      console.error('[academy/signed-url]', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ url: data.signedUrl });
  } catch (e) {
    console.error('[academy/signed-url]', e);
    return NextResponse.json({ error: 'Erro ao gerar URL' }, { status: 500 });
  }
}
