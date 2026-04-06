import { NextRequest, NextResponse } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { isLessonVisibleForProfile } from '@/lib/academy/lesson-role-access';

const BUCKET = 'academy-assets';
const SIGNED_URL_TTL = 14400; // 4 horas

/**
 * GET /api/academy/lessons/[slug]
 * Retorna uma aula por slug (com dados do módulo).
 * Resolve signed URL da thumbnail no servidor.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const slug = (await params).slug;
  if (!slug) {
    return NextResponse.json({ error: 'Slug obrigatório' }, { status: 400 });
  }
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

    const { data: lesson, error: lessonError } = await supabaseServiceRole
      .from('academy_lessons')
      .select(`
        id, module_id, title, slug, description, order_index, is_published,
        content_type, estimated_minutes, thumbnail_url,
        vturb_player_id, vturb_project_id, vturb_aspect_ratio, vturb_use_sdk,
        iframe_html, cta_label, cta_type, cta_url, cta_target,
        allowed_role_codes
      `)
      .eq('slug', slug)
      .eq('is_published', true)
      .single();

    if (lessonError || !lesson) {
      return NextResponse.json({ error: 'Aula não encontrada' }, { status: 404 });
    }

    const allowed = lesson.allowed_role_codes as string[] | null | undefined;
    const visible = isLessonVisibleForProfile(allowed, profileStatus);
    if (!visible) {
      if (profileStatus) {
        return NextResponse.json(
          {
            error: 'Esta aula não está disponível para o seu perfil.',
            code: 'ACADEMY_ROLE_DENIED',
          },
          { status: 403 }
        );
      }
      return NextResponse.json({ error: 'Aula não encontrada' }, { status: 404 });
    }

    const { allowed_role_codes: _omit, ...lessonPublic } = lesson as typeof lesson & {
      allowed_role_codes?: string[] | null;
    };

    // Resolve signed URL da thumbnail se for um path de storage
    if (lessonPublic.thumbnail_url && !lessonPublic.thumbnail_url.startsWith('http')) {
      const { data: signed } = await supabaseServiceRole.storage
        .from(BUCKET)
        .createSignedUrl(lessonPublic.thumbnail_url, SIGNED_URL_TTL);
      if (signed?.signedUrl) {
        lessonPublic.thumbnail_url = signed.signedUrl;
      }
    }

    const [moduleRes, attachmentsRes] = await Promise.all([
      supabaseServiceRole
        .from('academy_modules')
        .select('id, title, slug')
        .eq('id', lessonPublic.module_id)
        .single(),
      supabaseServiceRole
        .from('academy_lesson_attachments')
        .select(`
          id, order_index, label,
          academy_assets ( id, type, title, file_path, public_url )
        `)
        .eq('lesson_id', lessonPublic.id)
        .order('order_index', { ascending: true }),
    ]);

    return NextResponse.json({
      ...lessonPublic,
      module: moduleRes.data ?? null,
      attachments: attachmentsRes.data ?? [],
    });
  } catch (e) {
    console.error('[academy/lessons/[slug]]', e);
    return NextResponse.json({ error: 'Erro ao buscar aula' }, { status: 500 });
  }
}
