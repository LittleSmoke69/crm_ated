import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const BUCKET = 'academy-assets';

const ALLOWED_TYPES = ['image', 'table', 'pdf', 'doc', 'docx', 'other'] as const;
type AssetType = (typeof ALLOWED_TYPES)[number];

/** Infere o tipo do asset a partir da extensão ou MIME (para material de apoio). */
function inferAssetType(fileName: string, mimeType: string): AssetType {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const mime = (mimeType || '').toLowerCase();
  if (ext === 'pdf' || mime.includes('pdf')) return 'pdf';
  if (ext === 'doc' || mime.includes('msword')) return 'doc';
  if (ext === 'docx' || mime.includes('wordprocessingml')) return 'docx';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext) || mime.startsWith('image/')) return 'image';
  if (['xls', 'xlsx', 'csv'].includes(ext) || mime.includes('spreadsheet') || mime.includes('csv') || mime.includes('excel')) return 'table';
  return 'other';
}

/**
 * POST /api/admin/academy/upload
 * FormData: file, type? (image|table|pdf|doc|docx|other), title, description?, category?
 * Upload para Storage e cria registro em academy_assets.
 * Tipo pode ser omitido: inferido pela extensão/MIME. Qualquer material pode ser baixado pelo usuário.
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
  let type = (formData.get('type') as string) || '';
  const title = (formData.get('title') as string)?.trim() || 'Sem título';
  const description = (formData.get('description') as string)?.trim() || null;
  const category = (formData.get('category') as string)?.trim() || null;
  if (!file || !file.size) return NextResponse.json({ error: 'Arquivo obrigatório' }, { status: 400 });
  if (!ALLOWED_TYPES.includes(type as AssetType)) type = inferAssetType(file.name, file.type);
  const assetType = type as AssetType;

  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  const filePath = `${assetType}/${safeName}`;
  const contentType = file.type || 'application/octet-stream';

  try {
    const buf = await file.arrayBuffer();
    const { error: uploadError } = await supabaseServiceRole.storage
      .from(BUCKET)
      .upload(filePath, buf, { contentType, upsert: false });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabaseServiceRole.storage.from(BUCKET).getPublicUrl(filePath);
    const { data: row, error: insertError } = await supabaseServiceRole
      .from('academy_assets')
      .insert({
        type: assetType,
        title,
        description,
        file_path: filePath,
        public_url: urlData?.publicUrl ?? null,
        category,
        is_published: true,
      })
      .select()
      .single();
    if (insertError) throw insertError;
    return NextResponse.json(row);
  } catch (e) {
    console.error('[admin/academy/upload]', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
