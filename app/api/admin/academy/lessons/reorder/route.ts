import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * POST /api/admin/academy/lessons/reorder
 * Body: { orderedIds: string[] } — ordem dos IDs define order_index (0, 1, 2, ...) por módulo.
 * orderedIds deve conter apenas IDs de aulas do mesmo módulo (ou todas, atualizando cada uma pelo índice).
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
  let body: { orderedIds: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }
  const { orderedIds } = body;
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return NextResponse.json({ error: 'orderedIds deve ser um array não vazio' }, { status: 400 });
  }
  try {
    for (let i = 0; i < orderedIds.length; i++) {
      await supabaseServiceRole
        .from('academy_lessons')
        .update({ order_index: i, updated_at: new Date().toISOString() })
        .eq('id', orderedIds[i]);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[admin/academy/lessons/reorder]', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
