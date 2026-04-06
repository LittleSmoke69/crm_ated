import { NextRequest, NextResponse } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { isLessonVisibleForProfile } from '@/lib/academy/lesson-role-access';

const BUCKET = 'academy-assets';
const SIGNED_URL_TTL = 14400; // 4 horas

/**
 * GET /api/academy/modules
 * Lista módulos publicados (order_index).
 * Resolve signed URLs das thumbnails no servidor para o cliente não precisar
 * de um segundo round-trip por imagem.
 */
export async function GET(req: NextRequest) {
  try {
    const viewerId =
      req.headers.get('x-user-id') || req.nextUrl.searchParams.get('userId') || null;
    let profileStatus: string | null = null;
    if (viewerId) {
      const { data: prof } = await supabaseServiceRole
        .from('profiles')
        .select('status')
        .eq('id', viewerId)
        .maybeSingle();
      profileStatus = prof?.status ?? null;
    }

    const { data, error } = await supabaseServiceRole
      .from('academy_modules')
      .select('id, title, slug, description, order_index, thumbnail_url, tags')
      .eq('is_published', true)
      .order('order_index', { ascending: true });

    if (error) {
      console.error('[academy/modules]', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data: lessonRows } = await supabaseServiceRole
      .from('academy_lessons')
      .select('module_id, allowed_role_codes')
      .eq('is_published', true);

    const moduleHasVisibleLesson = new Set<string>();
    for (const l of lessonRows ?? []) {
      if (
        isLessonVisibleForProfile(l.allowed_role_codes as string[] | null, profileStatus)
      ) {
        moduleHasVisibleLesson.add(l.module_id);
      }
    }

    const rows = (data ?? []).filter((m) => moduleHasVisibleLesson.has(m.id));

    // Coleta paths que ainda não são URLs públicas (http)
    const paths = rows
      .map((m) => m.thumbnail_url)
      .filter((u): u is string => !!u && !u.startsWith('http'));

    if (paths.length > 0) {
      const { data: signed } = await supabaseServiceRole.storage
        .from(BUCKET)
        .createSignedUrls(paths, SIGNED_URL_TTL);

      if (signed) {
        const urlMap = new Map(signed.map((s) => [s.path, s.signedUrl]));
        for (const row of rows) {
          if (row.thumbnail_url && !row.thumbnail_url.startsWith('http')) {
            row.thumbnail_url = urlMap.get(row.thumbnail_url) ?? row.thumbnail_url;
          }
        }
      }
    }

    const cacheControl = viewerId
      ? 'private, no-store'
      : 'public, max-age=600, stale-while-revalidate=300';

    return NextResponse.json(rows, {
      headers: {
        'Cache-Control': cacheControl,
      },
    });
  } catch (e) {
    console.error('[academy/modules]', e);
    return NextResponse.json({ error: 'Erro ao listar módulos' }, { status: 500 });
  }
}
