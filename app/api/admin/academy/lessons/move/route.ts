import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const MAX_BATCH = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

/**
 * POST /api/admin/academy/lessons/move
 * Body: { lessonIds: string[], targetModuleId: string }
 * Move aulas para outro módulo, preservando a ordem relativa (module_id + order_index atuais)
 * e posicionando-as ao final do módulo destino.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }

  let body: { lessonIds?: unknown; targetModuleId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
  }

  const targetRaw = typeof body.targetModuleId === 'string' ? body.targetModuleId.trim() : '';
  if (!targetRaw || !isUuid(targetRaw)) {
    return NextResponse.json({ error: 'targetModuleId inválido' }, { status: 400 });
  }

  const idsRaw = body.lessonIds;
  if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
    return NextResponse.json({ error: 'lessonIds deve ser um array não vazio' }, { status: 400 });
  }

  const lessonIds = [...new Set(idsRaw.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean))];
  if (lessonIds.length === 0) {
    return NextResponse.json({ error: 'Nenhum id de aula válido' }, { status: 400 });
  }
  if (lessonIds.length > MAX_BATCH) {
    return NextResponse.json({ error: `Máximo de ${MAX_BATCH} aulas por vez` }, { status: 400 });
  }
  if (!lessonIds.every(isUuid)) {
    return NextResponse.json({ error: 'Um ou mais IDs de aula inválidos' }, { status: 400 });
  }

  try {
    const { data: mod, error: modErr } = await supabaseServiceRole
      .from('academy_modules')
      .select('id')
      .eq('id', targetRaw)
      .maybeSingle();
    if (modErr) throw modErr;
    if (!mod) {
      return NextResponse.json({ error: 'Módulo de destino não encontrado' }, { status: 404 });
    }

    const { data: rows, error: fetchErr } = await supabaseServiceRole
      .from('academy_lessons')
      .select('id, module_id, order_index')
      .in('id', lessonIds);
    if (fetchErr) throw fetchErr;

    const found = new Set((rows ?? []).map((r) => r.id));
    const missing = lessonIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `${missing.length} aula(s) não encontrada(s)` },
        { status: 404 }
      );
    }

    const toMove = (rows ?? [])
      .filter((r) => r.module_id !== targetRaw)
      .sort((a, b) => {
        const ma = String(a.module_id);
        const mb = String(b.module_id);
        if (ma !== mb) return ma.localeCompare(mb);
        return (a.order_index ?? 0) - (b.order_index ?? 0);
      });

    if (toMove.length === 0) {
      return NextResponse.json({
        ok: true,
        moved: 0,
        skipped: lessonIds.length,
        message: 'Todas as aulas selecionadas já estão neste módulo',
      });
    }

    const { data: inTarget, error: targetErr } = await supabaseServiceRole
      .from('academy_lessons')
      .select('order_index')
      .eq('module_id', targetRaw);
    if (targetErr) throw targetErr;

    let next = Math.max(-1, ...((inTarget ?? []).map((r) => r.order_index ?? 0)));
    const now = new Date().toISOString();

    for (const row of toMove) {
      next += 1;
      const { error: upErr } = await supabaseServiceRole
        .from('academy_lessons')
        .update({
          module_id: targetRaw,
          order_index: next,
          updated_at: now,
        })
        .eq('id', row.id);
      if (upErr) throw upErr;
    }

    return NextResponse.json({
      ok: true,
      moved: toMove.length,
      skipped: lessonIds.length - toMove.length,
    });
  } catch (e) {
    console.error('[admin/academy/lessons/move]', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
