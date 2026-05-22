import { NextRequest, NextResponse } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { requireAuth } from '@/lib/middleware/auth';
import { ApiHttpError } from '@/lib/utils/response';
import { getUserProfile } from '@/lib/middleware/permissions';
import { isLessonVisibleForProfile } from '@/lib/academy/lesson-role-access';

/**
 * GET /api/academy/progress — progresso do usuário autenticado (sessão).
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { data, error } = await supabaseServiceRole
      .from('academy_user_progress')
      .select('lesson_id, status, completed_at, last_seen_at')
      .eq('user_id', userId);

    if (error) {
      console.error('[academy/progress] GET', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data ?? []);
  } catch (e: unknown) {
    if (e instanceof ApiHttpError) {
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    }
    return NextResponse.json({ error: 'Erro ao buscar progresso' }, { status: 500 });
  }
}

/**
 * POST /api/academy/progress
 * Body: { lessonId, status }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    let body: { lessonId: string; status: 'not_started' | 'in_progress' | 'completed' };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
    }
    const { lessonId, status } = body;
    if (!lessonId || !status) {
      return NextResponse.json({ error: 'lessonId e status obrigatórios' }, { status: 400 });
    }
    if (!['not_started', 'in_progress', 'completed'].includes(status)) {
      return NextResponse.json({ error: 'status inválido' }, { status: 400 });
    }

    const profile = await getUserProfile(userId);
    const { data: lessonRow } = await supabaseServiceRole
      .from('academy_lessons')
      .select('id, allowed_role_codes')
      .eq('id', lessonId)
      .eq('is_published', true)
      .maybeSingle();
    if (!lessonRow) {
      return NextResponse.json({ error: 'Aula não encontrada' }, { status: 404 });
    }
    if (
      !isLessonVisibleForProfile(
        lessonRow.allowed_role_codes as string[] | null,
        profile?.status ?? null
      )
    ) {
      return NextResponse.json(
        { error: 'Você não tem permissão para registrar progresso nesta aula.' },
        { status: 403 }
      );
    }

    const now = new Date().toISOString();
    const payload = {
      user_id: userId,
      lesson_id: lessonId,
      status,
      updated_at: now,
      ...(status === 'completed' ? { completed_at: now } : {}),
      last_seen_at: now,
    };
    const { data, error } = await supabaseServiceRole
      .from('academy_user_progress')
      .upsert(payload, {
        onConflict: 'user_id,lesson_id',
        ignoreDuplicates: false,
      })
      .select()
      .single();

    if (error) {
      console.error('[academy/progress] POST', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (e: unknown) {
    if (e instanceof ApiHttpError) {
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    }
    return NextResponse.json({ error: 'Erro ao salvar progresso' }, { status: 500 });
  }
}
