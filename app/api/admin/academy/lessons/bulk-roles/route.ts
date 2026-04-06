import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { parseAllowedRoleCodesFromBody } from '@/lib/academy/lesson-role-access';

const MAX_BATCH = 500;

/**
 * POST /api/admin/academy/lessons/bulk-roles
 * Body: { lessonIds: string[], allowed_role_codes: string[] | null }
 * Define o mesmo allowed_role_codes para várias aulas (null ou [] = todos os cargos).
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }

  let body: { lessonIds?: unknown; allowed_role_codes?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 });
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

  const roleCodes = parseAllowedRoleCodesFromBody(body.allowed_role_codes);
  if (roleCodes === undefined) {
    return NextResponse.json({ error: 'allowed_role_codes obrigatório (use null ou [] para todos os cargos)' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseServiceRole
    .from('academy_lessons')
    .update({ allowed_role_codes: roleCodes, updated_at: now })
    .in('id', lessonIds)
    .select('id');

  if (error) {
    console.error('[admin/academy/lessons/bulk-roles]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const updated = data?.length ?? 0;
  return NextResponse.json({ ok: true, updated, requested: lessonIds.length });
}
