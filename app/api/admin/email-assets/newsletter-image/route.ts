/**
 * POST /api/admin/email-assets/newsletter-image
 * Multipart campo "file" (JPEG/PNG/WebP) → Storage público email-assets/newsletter/consultoria.jpg
 * GET  → retorna a URL pública atual (e se o objeto existe).
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import {
  EMAIL_ASSETS_BUCKET,
  NEWSLETTER_IMAGE_PATH,
  getNewsletterImagePublicUrl,
} from '@/lib/email/newsletter-html';

export const dynamic = 'force-dynamic';

const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const publicUrl = getNewsletterImagePublicUrl();
    const { data, error } = await supabaseServiceRole.storage
      .from(EMAIL_ASSETS_BUCKET)
      .list('newsletter', { search: 'consultoria' });
    const exists = !error && (data || []).some((f) => f.name.startsWith('consultoria'));
    return successResponse({ public_url: publicUrl, exists: !!exists, path: NEWSLETTER_IMAGE_PATH });
  } catch (err) {
    return serverErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);

    const form = await req.formData().catch(() => null);
    const file = form?.get('file') as File | null;
    if (!file || !file.size) return errorResponse('Arquivo é obrigatório (campo file).', 400);
    if (file.size > MAX_SIZE) return errorResponse('Arquivo muito grande (máx. 5MB).', 400);

    const type = (file.type || '').toLowerCase();
    if (!ALLOWED.includes(type)) {
      return errorResponse('Use JPEG, PNG ou WebP.', 400);
    }

    const buf = Buffer.from(await file.arrayBuffer());

    // Garante bucket público (self-host sem migration prévia)
    const { data: buckets } = await supabaseServiceRole.storage.listBuckets();
    const hasBucket = (buckets || []).some((b) => b.name === EMAIL_ASSETS_BUCKET || b.id === EMAIL_ASSETS_BUCKET);
    if (!hasBucket) {
      const { error: createErr } = await supabaseServiceRole.storage.createBucket(EMAIL_ASSETS_BUCKET, {
        public: true,
        fileSizeLimit: MAX_SIZE,
        allowedMimeTypes: ALLOWED,
      });
      if (createErr && !/already exists/i.test(createErr.message || '')) {
        return errorResponse(
          `Não foi possível criar o bucket "${EMAIL_ASSETS_BUCKET}": ${createErr.message}. Rode migrations/create_email_assets_storage_bucket.sql.`,
          503
        );
      }
    }

    const { error: uploadError } = await supabaseServiceRole.storage
      .from(EMAIL_ASSETS_BUCKET)
      .upload(NEWSLETTER_IMAGE_PATH, buf, {
        contentType: type === 'image/jpg' ? 'image/jpeg' : type,
        upsert: true,
        cacheControl: '31536000',
      });

    if (uploadError) {
      const msg = uploadError.message || '';
      if (/bucket not found/i.test(msg)) {
        return errorResponse(
          'Bucket "email-assets" inexistente. Rode migrations/create_email_assets_storage_bucket.sql no Supabase.',
          503
        );
      }
      return errorResponse(`Erro no upload: ${msg}`, 500);
    }

    const publicUrl = getNewsletterImagePublicUrl();
    return successResponse(
      { public_url: publicUrl, path: NEWSLETTER_IMAGE_PATH },
      'Imagem publicada no Storage.'
    );
  } catch (err) {
    return serverErrorResponse(err);
  }
}
