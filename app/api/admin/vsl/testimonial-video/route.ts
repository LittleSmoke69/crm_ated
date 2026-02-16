import { NextRequest } from 'next/server';
import { requireVslProjectAccess } from '@/lib/middleware/vsl-admin';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

const BUCKET = 'brand-assets';
const MAX_SIZE = 80 * 1024 * 1024; // 80MB
const ALLOWED_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

/**
 * POST /api/admin/vsl/testimonial-video
 * Upload de vídeo para depoimento. FormData: project_id, file.
 * Salva em brand-assets/bancas/<project_id>/testimonials/<uuid>.<ext>
 * Retorna path para guardar em testimonial.video_path.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData().catch(() => null);
    const projectId = formData?.get('project_id')?.toString()?.trim();
    if (!projectId) return errorResponse('project_id é obrigatório', 400);
    await requireVslProjectAccess(req, projectId);

    const file = formData?.get('file') as File | null;
    if (!file || !file.size) return errorResponse('Arquivo de vídeo é obrigatório', 400);
    if (file.size > MAX_SIZE) return errorResponse('Vídeo muito grande (máx. 80MB)', 400);
    const type = file.type?.toLowerCase();
    if (!ALLOWED_TYPES.includes(type)) {
      return errorResponse('Use MP4 ou WebM.', 400);
    }

    const ext = type === 'video/quicktime' ? 'mov' : type.split('/')[1] || 'mp4';
    const id = crypto.randomUUID();
    const path = `bancas/${projectId}/testimonials/${id}.${ext}`;

    const buf = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await supabaseServiceRole.storage
      .from(BUCKET)
      .upload(path, buf, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('[admin/vsl/testimonial-video] upload', uploadError.message);
      return errorResponse('Erro ao fazer upload do vídeo', 500);
    }

    return successResponse({ path });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}
