import { NextRequest, NextResponse } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/academy/materials
 * Lista materiais de apoio publicados (PDF, DOC, imagens, etc.) para a área de membros.
 * Header opcional: x-user-id (se não enviado, ainda retorna a lista; controle de acesso pode ser no front).
 */
export async function GET(req: NextRequest) {
  try {
    const { data, error } = await supabaseServiceRole
      .from('academy_assets')
      .select('id, title, type, description, file_path, category, created_at')
      .eq('is_published', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[academy/materials]', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data ?? []);
  } catch (e) {
    console.error('[academy/materials]', e);
    return NextResponse.json({ error: 'Erro ao listar materiais' }, { status: 500 });
  }
}
