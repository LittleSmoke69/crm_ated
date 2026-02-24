import { NextRequest, NextResponse } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const BUCKET = 'academy-assets';

/**
 * GET /api/academy/thumbnail?path=xxx
 * Gera signed URL para a imagem (thumbnail) e redireciona (302).
 * Uso: <img src="/api/academy/thumbnail?path=thumbnails/..." />
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
    if (error) throw error;
    if (!data?.signedUrl) {
      return NextResponse.json({ error: 'URL não gerada' }, { status: 500 });
    }
    return NextResponse.redirect(data.signedUrl, 302);
  } catch (e) {
    console.error('[academy/thumbnail]', e);
    return NextResponse.json({ error: 'Erro ao gerar URL' }, { status: 500 });
  }
}
