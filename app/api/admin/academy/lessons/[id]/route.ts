import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { parseAllowedRoleCodesFromBody } from '@/lib/academy/lesson-role-access';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(_req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
  const id = (await params).id;
  try {
    const { data, error } = await supabaseServiceRole
      .from('academy_lessons')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) return NextResponse.json({ error: 'Aula não encontrada' }, { status: 404 });
    return NextResponse.json(data);
  } catch (e) {
    console.error('[admin/academy/lessons/[id]] GET', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
  const id = (await params).id;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }
  const allowed = [
    'title', 'slug', 'description', 'order_index', 'is_published', 'content_type', 'estimated_minutes',
    'thumbnail_url',
    'vturb_player_id', 'vturb_project_id', 'vturb_aspect_ratio', 'vturb_use_sdk', 'iframe_html',
    'cta_label', 'cta_type', 'cta_url', 'cta_target',
  ];
  const update: Record<string, unknown> = {};
  for (const k of allowed) {
    if (body[k] !== undefined) update[k] = body[k];
  }
  const roleCodes = parseAllowedRoleCodesFromBody(body.allowed_role_codes);
  if (roleCodes !== undefined) update.allowed_role_codes = roleCodes;
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'Nenhum campo para atualizar' }, { status: 400 });
  update.updated_at = new Date().toISOString();
  try {
    const { data, error } = await supabaseServiceRole.from('academy_lessons').update(update).eq('id', id).select().single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    console.error('[admin/academy/lessons/[id]] PATCH', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
  const id = (await params).id;
  try {
    const { error } = await supabaseServiceRole.from('academy_lessons').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[admin/academy/lessons/[id]] DELETE', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
