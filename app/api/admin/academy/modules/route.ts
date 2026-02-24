import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
  try {
    const { data, error } = await supabaseServiceRole
      .from('academy_modules')
      .select('*')
      .order('order_index', { ascending: true });
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (e) {
    console.error('[admin/academy/modules] GET', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
  let body: { title: string; slug: string; description?: string; order_index?: number; is_published?: boolean; thumbnail_url?: string; tags?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }
  const { title, slug, description, order_index = 0, is_published = false, thumbnail_url, tags } = body;
  if (!title || !slug) return NextResponse.json({ error: 'title e slug obrigatórios' }, { status: 400 });
  try {
    const { data, error } = await supabaseServiceRole
      .from('academy_modules')
      .insert({ title, slug, description: description ?? null, order_index, is_published, thumbnail_url: thumbnail_url ?? null, tags: tags ?? null })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    console.error('[admin/academy/modules] POST', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
