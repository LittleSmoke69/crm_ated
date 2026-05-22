import { NextRequest, NextResponse } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { authenticateRequest, validateUser } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import {
  ACADEMY_STORAGE_BUCKET,
  assertAcademyStoragePathReadable,
  sanitizeAcademyStoragePath,
} from '@/lib/academy/storage-access';

const SIGNED_URL_TTL = 3600;

/**
 * GET /api/academy/signed-url?path=xxx
 * URL assinada apenas para paths vinculados a conteúdo publicado (ou admin).
 */
export async function GET(req: NextRequest) {
  const pathParam = req.nextUrl.searchParams.get('path');
  const safePath = sanitizeAcademyStoragePath(pathParam);
  if (!safePath) {
    return NextResponse.json({ error: 'path inválido' }, { status: 400 });
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
      .createSignedUrl(safePath, SIGNED_URL_TTL);

    if (error) {
      console.error('[academy/signed-url]', error.message);
      return NextResponse.json({ error: 'Arquivo não encontrado' }, { status: 404 });
    }
    return NextResponse.json({ url: data.signedUrl });
  } catch (e) {
    console.error('[academy/signed-url]', e);
    return NextResponse.json({ error: 'Erro ao gerar URL' }, { status: 500 });
  }
}
