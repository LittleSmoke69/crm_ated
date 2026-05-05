import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const BUCKET = 'brand-assets';
const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

/**
 * POST /api/admin/zaploto/tenants/[tenantId]/logo
 * Multipart: campo "file". Grava em brand-assets/tenants/<tenantId>/logo.<ext>
 * e atualiza zaploto_tenants.logo_url com o caminho (não a URL assinada).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    await requireSuperAdmin(req);
    const { tenantId } = await params;

    const { data: tenant, error: tErr } = await supabaseServiceRole
      .from('zaploto_tenants')
      .select('id')
      .eq('id', tenantId)
      .maybeSingle();
    if (tErr || !tenant) return errorResponse('Tenant não encontrado', 404);

    const formData = await req.formData().catch(() => null);
    const file = formData?.get('file') as File | null;
    if (!file || !file.size) return errorResponse('Arquivo é obrigatório', 400);
    if (file.size > MAX_SIZE) return errorResponse('Arquivo muito grande (máx. 5MB)', 400);

    const type = file.type?.toLowerCase();
    if (!ALLOWED_TYPES.includes(type ?? '')) {
      return errorResponse('Use PNG, JPEG, WebP ou SVG.', 400);
    }

    const ext = type === 'image/svg+xml' ? 'svg' : (type?.split('/')[1] || 'png');
    const path = `tenants/${tenantId}/logo.${ext}`;

    const buf = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await supabaseServiceRole.storage
      .from(BUCKET)
      .upload(path, buf, { contentType: file.type, upsert: true });

    if (uploadError) {
      console.error('[tenant/logo] upload', uploadError.message);
      const msg = uploadError.message || '';
      if (/bucket not found/i.test(msg)) {
        return errorResponse(
          'Bucket "brand-assets" inexistente. Aplique migrations/create_brand_assets_storage_bucket.sql no Supabase.',
          503
        );
      }
      return errorResponse('Erro ao enviar logo', 500);
    }

    const { data: updated, error: uErr } = await supabaseServiceRole
      .from('zaploto_tenants')
      .update({ logo_url: path, updated_at: new Date().toISOString() })
      .eq('id', tenantId)
      .select()
      .single();

    if (uErr || !updated) {
      return errorResponse(uErr?.message || 'Erro ao atualizar tenant', 500);
    }

    return successResponse({ logo_path: path, tenant: updated });
  } catch (e: unknown) {
    return serverErrorResponse(e);
  }
}
