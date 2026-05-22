import { NextRequest, NextResponse } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { authenticateRequest, validateUser } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import {
  ACADEMY_STORAGE_BUCKET,
  assertAcademyStoragePathReadable,
  sanitizeAcademyStoragePath,
} from '@/lib/academy/storage-access';

/**
 * GET /api/academy/thumbnail?path=xxx
 * Redirect para signed URL (thumbnails publicadas ou usuário autenticado com acesso).
 */
export async function GET(req: NextRequest) {
  const pathParam = req.nextUrl.searchParams.get('path');
  const safePath = sanitizeAcademyStoragePath(pathParam);
  if (!safePath) {
    return NextResponse.json({ error: 'path obrigatório' }, { status: 400 });
  }

  try {
    const auth = await authenticateRequest(req);
    let profile = null;
    let userId: string | null = null;
    if (auth?.userId) {
      const valid = await validateUser(auth.userId);
      if (!valid) {
        return NextResponse.json({ error: 'Sessão inválida' }, { status: 401 });
      }
      userId = auth.userId;
      profile = await getUserProfile(auth.userId);
    }

    const access = await assertAcademyStoragePathReadable(safePath, { userId, profile });
    if (!access.ok) {
      return NextResponse.json({ error: access.message }, { status: access.status });
    }

    const { data, error } = await supabaseServiceRole.storage
      .from(ACADEMY_STORAGE_BUCKET)
      .createSignedUrl(safePath, 3600);
    if (error || !data?.signedUrl) {
      return NextResponse.json({ error: 'URL não gerada' }, { status: 404 });
    }
    return NextResponse.redirect(data.signedUrl, 302);
  } catch (e) {
    console.error('[academy/thumbnail]', e);
    return NextResponse.json({ error: 'Erro ao gerar URL' }, { status: 500 });
  }
}
