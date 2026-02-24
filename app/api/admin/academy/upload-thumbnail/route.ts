import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const BUCKET = 'academy-assets';
const ALLOWED_EXT = ['png', 'jpg', 'jpeg', 'webp'];

/**
 * POST /api/admin/academy/upload-thumbnail
 * FormData: file (imagem), moduleId
 * Faz upload para academy-assets/thumbnails/{moduleId}/{timestamp}.ext
 * Retorna { path } para salvar em academy_modules.thumbnail_url
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'FormData inválido' }, { status: 400 });
  }
  const file = formData.get('file') as File | null;
  const moduleId = (formData.get('moduleId') as string)?.trim();
  if (!file || !file.size) return NextResponse.json({ error: 'Arquivo obrigatório' }, { status: 400 });
  if (!moduleId) return NextResponse.json({ error: 'moduleId obrigatório' }, { status: 400 });
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (!ALLOWED_EXT.includes(ext)) {
    return NextResponse.json({ error: 'Apenas PNG, JPG, JPEG ou WEBP' }, { status: 400 });
  }
  const filePath = `thumbnails/${moduleId}/${Date.now()}.${ext}`;
  try {
    const buf = await file.arrayBuffer();
    const { error: uploadError } = await supabaseServiceRole.storage
      .from(BUCKET)
      .upload(filePath, buf, { contentType: file.type, upsert: true });
    if (uploadError) throw uploadError;
    return NextResponse.json({ path: filePath });
  } catch (e) {
    console.error('[admin/academy/upload-thumbnail]', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
