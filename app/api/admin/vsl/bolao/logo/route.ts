import { NextRequest } from 'next/server';
import { requireVslProjectAccess } from '@/lib/middleware/vsl-admin';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

const BUCKET = 'brand-assets';
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

/**
 * POST /api/admin/vsl/bolao/logo
 * Upload da logo do template Bolão.
 * Body (multipart): project_id + file (campo "file")
 *
 * Salva em brand-assets/bancas/<project_id>/bolao-landing-logos/<uuid>.<ext>
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData().catch(() => null);
    const projectId =
      formData?.get('project_id')?.toString() ??
      (await req.json().catch(() => ({} as { project_id?: string })))?.project_id;

    if (!projectId) return errorResponse('project_id é obrigatório', 400);
    await requireVslProjectAccess(req, projectId);

    const file = formData?.get('file') as File | null;
    if (!file || !file.size) return errorResponse('Arquivo de logo é obrigatório', 400);
    if (file.size > MAX_SIZE) return errorResponse('Arquivo muito grande (máx. 5MB)', 400);

    const type = file.type?.toLowerCase();
    if (!ALLOWED_TYPES.includes(type ?? '')) {
      return errorResponse('Tipo de arquivo não permitido. Use PNG, JPEG, WebP ou SVG.', 400);
    }

    const ext = type === 'image/svg+xml' ? 'svg' : (type.split('/')[1] || 'png');
    const filename = `${crypto.randomUUID()}.${ext}`;
    const path = `bancas/${projectId}/bolao-landing-logos/${filename}`;

    const buf = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await supabaseServiceRole.storage
      .from(BUCKET)
      .upload(path, buf, { contentType: file.type, upsert: false });

    if (uploadError) {
      console.error('[admin/vsl/bolao/logo] upload', uploadError.message);
      const msg = uploadError.message || '';
      if (/bucket not found/i.test(msg)) {
        return errorResponse(
          'Bucket de armazenamento "brand-assets" inexistente no Supabase. Aplique a migration migrations/create_brand_assets_storage_bucket.sql no projeto (SQL Editor) ou crie o bucket privado "brand-assets" em Storage.',
          503
        );
      }
      return errorResponse('Erro ao fazer upload da logo', 500);
    }

    return successResponse({ logo_path: path });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}

