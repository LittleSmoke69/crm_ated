import { NextRequest, NextResponse } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { isLessonVisibleForProfile } from '@/lib/academy/lesson-role-access';

function getUserId(req: NextRequest): string | null {
  return (
    req.headers.get('x-user-id') ||
    req.nextUrl.searchParams.get('userId') ||
    null
  );
}

/**
 * GET /api/academy/progress?userId=xxx (ou header x-user-id)
 * Lista progresso do usuário (lesson_id, status, completed_at).
 */
export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Usuário não identificado' }, { status: 401 });
  }
  try {
    const { data, error } = await supabaseServiceRole
      .from('academy_user_progress')
      .select('lesson_id, status, completed_at, last_seen_at')
      .eq('user_id', userId);

    if (error) {
      console.error('[academy/progress] GET', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data ?? []);
  } catch (e) {
    console.error('[academy/progress] GET', e);
    return NextResponse.json({ error: 'Erro ao buscar progresso' }, { status: 500 });
  }
}

/**
 * POST /api/academy/progress
 * Body: { lessonId: string, status: 'not_started' | 'in_progress' | 'completed' }
 * Header: x-user-id
 */
export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Usuário não identificado' }, { status: 401 });
  }
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
  try {
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .maybeSingle();
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
  } catch (e) {
    console.error('[academy/progress] POST', e);
    return NextResponse.json({ error: 'Erro ao salvar progresso' }, { status: 500 });
  }
}
