import { NextResponse } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/academy/modules
 * Lista módulos publicados (order_index).
 */
export async function GET() {
  try {
    const { data, error } = await supabaseServiceRole
      .from('academy_modules')
      .select('id, title, slug, description, order_index, thumbnail_url, tags')
      .eq('is_published', true)
      .order('order_index', { ascending: true });

    if (error) {
      console.error('[academy/modules]', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data ?? []);
  } catch (e) {
    console.error('[academy/modules]', e);
    return NextResponse.json({ error: 'Erro ao listar módulos' }, { status: 500 });
  }
}
