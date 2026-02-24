import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
  const moduleId = req.nextUrl.searchParams.get('moduleId');
  try {
    let q = supabaseServiceRole.from('academy_lessons').select('*').order('order_index', { ascending: true });
    if (moduleId) q = q.eq('module_id', moduleId);
    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (e) {
    console.error('[admin/academy/lessons] GET', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
  let body: {
    module_id: string;
    title: string;
    slug: string;
    description?: string;
    order_index?: number;
    is_published?: boolean;
    content_type: 'vturb' | 'iframe' | 'text';
    estimated_minutes?: number;
    vturb_player_id?: string;
    vturb_project_id?: string;
    vturb_aspect_ratio?: number;
    vturb_use_sdk?: boolean;
    iframe_html?: string;
    cta_label?: string;
    cta_type?: 'internal' | 'external';
    cta_url?: string;
    cta_target?: '_self' | '_blank';
    thumbnail_url?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }
  const { module_id, title, slug, content_type } = body;
  if (!module_id || !title || !slug || !content_type) {
    return NextResponse.json({ error: 'module_id, title, slug e content_type obrigatórios' }, { status: 400 });
  }
  try {
    const insert = {
      module_id: body.module_id,
      title: body.title,
      slug: body.slug,
      description: body.description ?? null,
      order_index: body.order_index ?? 0,
      is_published: body.is_published ?? false,
      content_type: body.content_type,
      estimated_minutes: body.estimated_minutes ?? null,
      thumbnail_url: body.thumbnail_url ?? null,
      vturb_player_id: body.vturb_player_id ?? null,
      vturb_project_id: body.vturb_project_id ?? null,
      vturb_aspect_ratio: body.vturb_aspect_ratio ?? null,
      vturb_use_sdk: body.vturb_use_sdk ?? true,
      iframe_html: body.iframe_html ?? null,
      cta_label: body.cta_label ?? null,
      cta_type: body.cta_type ?? null,
      cta_url: body.cta_url ?? null,
      cta_target: body.cta_target ?? '_self',
    };
    const { data, error } = await supabaseServiceRole.from('academy_lessons').insert(insert).select().single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    console.error('[admin/academy/lessons] POST', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
