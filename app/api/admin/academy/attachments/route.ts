import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/** GET ?lessonId=xxx - anexos da aula. POST - adicionar. DELETE - remover. */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
  const lessonId = req.nextUrl.searchParams.get('lessonId');
  if (!lessonId) return NextResponse.json({ error: 'lessonId obrigatório' }, { status: 400 });
  try {
    const { data, error } = await supabaseServiceRole
      .from('academy_lesson_attachments')
      .select('id, lesson_id, asset_id, label, order_index, academy_assets(id, type, title, file_path)')
      .eq('lesson_id', lessonId)
      .order('order_index', { ascending: true });
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (e) {
    console.error('[admin/academy/attachments] GET', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
  let body: { lesson_id: string; asset_id: string; label?: string; order_index?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }
  const { lesson_id, asset_id, label, order_index = 0 } = body;
  if (!lesson_id || !asset_id) return NextResponse.json({ error: 'lesson_id e asset_id obrigatórios' }, { status: 400 });
  try {
    const { data, error } = await supabaseServiceRole
      .from('academy_lesson_attachments')
      .insert({ lesson_id, asset_id, label: label ?? null, order_index })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    console.error('[admin/academy/attachments] POST', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id do anexo obrigatório' }, { status: 400 });
  try {
    const { error } = await supabaseServiceRole.from('academy_lesson_attachments').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[admin/academy/attachments] DELETE', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
