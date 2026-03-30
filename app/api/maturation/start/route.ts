/**
 * POST /api/maturation/start
 *
 * Inicia um job de maturação (mesma lógica da Netlify Function maturation-start).
 * Usado em desenvolvimento local quando a função Netlify não está disponível.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { runMaturationStart } from '@/lib/services/maturation/start-job';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    const userId = auth.userId;
    if (!userId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const result = await runMaturationStart(supabaseServiceRole, {
      userId,
      body: {
        plan_id: body.plan_id,
        target_chat_id: body.target_chat_id,
        use_virgin_messages: body.use_virgin_messages,
        preferred_evolution_instance_ids: body.preferred_evolution_instance_ids,
        delay_seconds_override: body.delay_seconds_override != null ? Number(body.delay_seconds_override) : undefined,
      },
    });

    if (result.success) {
      return NextResponse.json({
        success: true,
        job_id: result.job_id,
        job_ids: result.job_ids,
        campaign_id: result.campaign_id,
        master_instance: result.master_instance,
        master_instances: result.master_instances,
        total_steps: result.total_steps,
      });
    }

    return NextResponse.json(
      { error: result.error },
      { status: result.statusCode }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro ao iniciar job';
    return NextResponse.json(
      { error: message },
      { status: message === 'Não autenticado' ? 401 : 500 }
    );
  }
}
