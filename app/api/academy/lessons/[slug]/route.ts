import { NextRequest, NextResponse } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const BUCKET = 'academy-assets';
const SIGNED_URL_TTL = 14400; // 4 horas

/**
 * GET /api/academy/lessons/[slug]
 * Retorna uma aula por slug (com dados do módulo).
 * Resolve signed URL da thumbnail no servidor.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const slug = (await params).slug;
  if (!slug) {
    return NextResponse.json({ error: 'Slug obrigatório' }, { status: 400 });
  }
  try {
    const { data: lesson, error: lessonError } = await supabaseServiceRole
      .from('academy_lessons')
      .select(`
        id, module_id, title, slug, description, order_index, is_published,
        content_type, estimated_minutes, thumbnail_url,
        vturb_player_id, vturb_project_id, vturb_aspect_ratio, vturb_use_sdk,
        iframe_html, cta_label, cta_type, cta_url, cta_target
      `)
      .eq('slug', slug)
      .eq('is_published', true)
      .single();

    if (lessonError || !lesson) {
      return NextResponse.json({ error: 'Aula não encontrada' }, { status: 404 });
    }

    // Resolve signed URL da thumbnail se for um path de storage
    if (lesson.thumbnail_url && !lesson.thumbnail_url.startsWith('http')) {
      const { data: signed } = await supabaseServiceRole.storage
        .from(BUCKET)
        .createSignedUrl(lesson.thumbnail_url, SIGNED_URL_TTL);
      if (signed?.signedUrl) {
        lesson.thumbnail_url = signed.signedUrl;
      }
    }

    const [moduleRes, attachmentsRes] = await Promise.all([
      supabaseServiceRole
        .from('academy_modules')
        .select('id, title, slug')
        .eq('id', lesson.module_id)
        .single(),
      supabaseServiceRole
        .from('academy_lesson_attachments')
        .select(`
          id, order_index, label,
          academy_assets ( id, type, title, file_path, public_url )
        `)
        .eq('lesson_id', lesson.id)
        .order('order_index', { ascending: true }),
    ]);

    return NextResponse.json({
      ...lesson,
      module: moduleRes.data ?? null,
      attachments: attachmentsRes.data ?? [],
    });
  } catch (e) {
    console.error('[academy/lessons/[slug]]', e);
    return NextResponse.json({ error: 'Erro ao buscar aula' }, { status: 500 });
  }
}
