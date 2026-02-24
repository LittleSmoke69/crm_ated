import { NextRequest, NextResponse } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/academy/lessons/[slug]
 * Retorna uma aula por slug (com dados do módulo).
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
        content_type, estimated_minutes,
        vturb_player_id, vturb_project_id, vturb_aspect_ratio, vturb_use_sdk,
        iframe_html, cta_label, cta_type, cta_url, cta_target
      `)
      .eq('slug', slug)
      .eq('is_published', true)
      .single();

    if (lessonError || !lesson) {
      return NextResponse.json({ error: 'Aula não encontrada' }, { status: 404 });
    }

    const { data: module } = await supabaseServiceRole
      .from('academy_modules')
      .select('id, title, slug')
      .eq('id', lesson.module_id)
      .single();

    const { data: attachments } = await supabaseServiceRole
      .from('academy_lesson_attachments')
      .select(`
        id, order_index, label,
        academy_assets ( id, type, title, file_path, public_url )
      `)
      .eq('lesson_id', lesson.id)
      .order('order_index', { ascending: true });

    return NextResponse.json({
      ...lesson,
      module: module ?? null,
      attachments: attachments ?? [],
    });
  } catch (e) {
    console.error('[academy/lessons/[slug]]', e);
    return NextResponse.json({ error: 'Erro ao buscar aula' }, { status: 500 });
  }
}
