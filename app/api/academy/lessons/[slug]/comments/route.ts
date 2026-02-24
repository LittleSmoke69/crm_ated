import { NextRequest, NextResponse } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

function getUserId(req: NextRequest): string | null {
  return req.headers.get('x-user-id') ?? null;
}

/**
 * GET /api/academy/lessons/[slug]/comments
 * Lista comentários da aula (apenas se a aula estiver publicada).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const slug = (await params).slug;
  if (!slug) return NextResponse.json({ error: 'Slug obrigatório' }, { status: 400 });
  try {
    const { data: lesson } = await supabaseServiceRole
      .from('academy_lessons')
      .select('id')
      .eq('slug', slug)
      .eq('is_published', true)
      .maybeSingle();
    if (!lesson) return NextResponse.json({ error: 'Aula não encontrada' }, { status: 404 });

    const { data, error } = await supabaseServiceRole
      .from('academy_lesson_comments')
      .select('id, lesson_id, user_id, parent_id, body, created_at, updated_at')
      .eq('lesson_id', lesson.id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[academy/comments] GET', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data ?? []);
  } catch (e) {
    console.error('[academy/comments] GET', e);
    return NextResponse.json({ error: 'Erro ao listar comentários' }, { status: 500 });
  }
}

/**
 * POST /api/academy/lessons/[slug]/comments
 * Body: { body: string, parent_id?: string } — parent_id para respostas
 * Header: x-user-id (obrigatório)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: 'Faça login para comentar' }, { status: 401 });
  const slug = (await params).slug;
  if (!slug) return NextResponse.json({ error: 'Slug obrigatório' }, { status: 400 });
  let body: { body?: string; parent_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const text = (body.body ?? '').trim();
  if (!text) return NextResponse.json({ error: 'Comentário não pode estar vazio' }, { status: 400 });
  try {
    const { data: lesson } = await supabaseServiceRole
      .from('academy_lessons')
      .select('id')
      .eq('slug', slug)
      .eq('is_published', true)
      .maybeSingle();
    if (!lesson) return NextResponse.json({ error: 'Aula não encontrada' }, { status: 404 });

    const insert: { lesson_id: string; user_id: string; body: string; parent_id?: string } = {
      lesson_id: lesson.id,
      user_id: userId,
      body: text,
    };
    if (body.parent_id) insert.parent_id = body.parent_id;

    const { data, error } = await supabaseServiceRole
      .from('academy_lesson_comments')
      .insert(insert)
      .select('id, lesson_id, user_id, parent_id, body, created_at')
      .single();

    if (error) {
      console.error('[academy/comments] POST', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (e) {
    console.error('[academy/comments] POST', e);
    return NextResponse.json({ error: 'Erro ao publicar comentário' }, { status: 500 });
  }
}
