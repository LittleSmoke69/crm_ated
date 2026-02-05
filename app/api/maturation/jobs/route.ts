/**
 * API Route: /api/maturation/jobs
 * 
 * GET: Lista jobs do usuário
 * POST: Cria novo job (chama Netlify Function maturation-start)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    const userId = auth.userId;
    
    // Query params
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status'); // queued|running|paused|finished|failed|aborted
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    
    // Monta query
    let query = supabaseServiceRole
      .from('maturation_jobs')
      .select(`
        *,
        maturation_plans (
          id,
          name,
          description
        ),
        master_instances (
          id,
          evolution_instances (
            instance_name
          )
        )
      `)
      .eq('owner_user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (status) {
      query = query.eq('status', status);
    }
    
    const { data: jobs, error } = await query;
    
    if (error) {
      console.error('[GET /api/maturation/jobs] Erro:', error);
      return NextResponse.json(
        { error: 'Erro ao buscar jobs' },
        { status: 500 }
      );
    }
    
    // Formata resposta
    const formattedJobs = (jobs || []).map((job: any) => {
      const instance = Array.isArray(job.master_instances?.evolution_instances)
        ? job.master_instances.evolution_instances[0]
        : job.master_instances?.evolution_instances;
      
      return {
        id: job.id,
        plan: job.maturation_plans,
        instance_name: instance?.instance_name || null,
        target_chat_id: job.target_chat_id,
        status: job.status,
        progress_total: job.progress_total,
        progress_done: job.progress_done,
        progress_percent: job.progress_total > 0 
          ? Math.round((job.progress_done / job.progress_total) * 100)
          : 0,
        started_at: job.started_at,
        ended_at: job.ended_at,
        created_at: job.created_at,
      };
    });
    
    return NextResponse.json({
      jobs: formattedJobs,
      total: formattedJobs.length,
    });
  } catch (error: any) {
    console.error('[GET /api/maturation/jobs] Erro:', error);
    return NextResponse.json(
      { error: error.message || 'Erro ao buscar jobs' },
      { status: error.message === 'Não autenticado' ? 401 : 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    const userId = auth.userId;
    
    const body = await req.json();
    const { plan_id, target_chat_id, use_virgin_messages, preferred_evolution_instance_ids, delay_seconds_override } = body;
    
    const useVirgin = use_virgin_messages === true;
    if (!useVirgin && !plan_id) {
      return NextResponse.json(
        { error: 'plan_id é obrigatório (ou use use_virgin_messages: true com target_chat_id)' },
        { status: 400 }
      );
    }
    
    // Em produção (Netlify) chama a função; em dev local chama a API interna (evita Invalid URL com path relativo)
    const netlifyBase = process.env.NETLIFY_FUNCTIONS_URL || process.env.NEXT_PUBLIC_NETLIFY_FUNCTIONS_URL || '';
    const useNetlifyFunction =
      netlifyBase &&
      (netlifyBase.startsWith('http://') || netlifyBase.startsWith('https://'));

    const payload: Record<string, unknown> = {
      target_chat_id: target_chat_id || undefined,
      preferred_evolution_instance_ids: Array.isArray(preferred_evolution_instance_ids) ? preferred_evolution_instance_ids : undefined,
      delay_seconds_override: delay_seconds_override != null ? Number(delay_seconds_override) : undefined,
    };
    if (useVirgin) {
      payload.use_virgin_messages = true;
    } else {
      payload.plan_id = plan_id;
    }

    let functionUrl: string;
    if (useNetlifyFunction) {
      functionUrl = `${netlifyBase.replace(/\/$/, '')}/maturation-start`;
    } else {
      const origin = req.nextUrl?.origin || req.headers.get('x-forwarded-host') || 'http://localhost:3000';
      const base = origin.startsWith('http') ? origin : `https://${origin}`;
      functionUrl = `${base}/api/maturation/start`;
    }

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': userId,
        Authorization: `Bearer ${userId}`,
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: result.error || 'Erro ao iniciar job' },
        { status: response.status }
      );
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[POST /api/maturation/jobs] Erro:', error);
    return NextResponse.json(
      { error: error.message || 'Erro ao criar job' },
      { status: error.message === 'Não autenticado' ? 401 : 500 }
    );
  }
}

