/**
 * POST /api/anti-spam/groups/remove-invalid
 * Inicia remoção assíncrona de números inválidos dos grupos monitorados.
 * Cria um job no banco e dispara o processamento em background (fire-and-forget).
 * Retorna { job_id, status: 'pending' } imediatamente — sem timeout na Netlify.
 *
 * GET /api/anti-spam/groups/remove-invalid?job_id=<uuid>
 * Polling de status do job. Retorna status + resultado quando concluído.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const LOG_PREFIX = '[anti-spam/remove-invalid]';

export const runtime = 'nodejs';
export const maxDuration = 30;

// ---------------------------------------------------------------------------
// POST — cria job e dispara o processamento em background
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json().catch(() => ({}));
    const configId = (body.config_id ?? req.nextUrl.searchParams.get('config_id'))?.trim();

    if (!configId) {
      return errorResponse('config_id é obrigatório', 400);
    }

    // Valida que a config pertence ao usuário
    const { data: config, error: cfgErr } = await supabaseServiceRole
      .from('anti_spam_configs')
      .select('id')
      .eq('id', configId)
      .eq('owner_type', 'user')
      .eq('owner_id', userId)
      .single();

    if (cfgErr || !config) {
      return errorResponse('Configuração não encontrada', 404);
    }

    // Cria o job no banco
    const { data: job, error: jobErr } = await supabaseServiceRole
      .from('anti_spam_remove_jobs')
      .insert({ config_id: configId, owner_id: userId, status: 'pending' })
      .select('id')
      .single();

    if (jobErr || !job) {
      console.error(LOG_PREFIX, 'erro ao criar job', { configId, jobErr });
      return errorResponse('Erro ao criar job de remoção', 500);
    }

    // Fire-and-forget: dispara o processamento na rota interna.
    // A rota /process tem maxDuration=300 e roda independente desta conexão.
    const host = req.headers.get('host') ?? 'localhost:3000';
    const protocol = host.startsWith('localhost') ? 'http' : 'https';
    void fetch(`${protocol}://${host}/api/anti-spam/groups/remove-invalid/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': process.env.CRON_SECRET ?? '',
      },
      body: JSON.stringify({ job_id: job.id }),
    }).catch((err) => {
      console.error(LOG_PREFIX, 'falha ao disparar processo background', { job_id: job.id, err: err?.message });
    });

    console.log(LOG_PREFIX, 'job criado', { job_id: job.id, configId, userId: userId?.slice(0, 8) });

    return successResponse({ job_id: job.id, status: 'pending' });
  } catch (err: any) {
    console.error(LOG_PREFIX, 'erro', { message: err?.message });
    return errorResponse(err.message || 'Erro ao iniciar remoção', 500);
  }
}

// ---------------------------------------------------------------------------
// GET — polling de status do job
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const jobId = req.nextUrl.searchParams.get('job_id')?.trim();

    if (!jobId) return errorResponse('job_id é obrigatório', 400);

    const { data: job, error } = await supabaseServiceRole
      .from('anti_spam_remove_jobs')
      .select('id, status, result, error, created_at, updated_at')
      .eq('id', jobId)
      .eq('owner_id', userId)
      .single();

    if (error || !job) return errorResponse('Job não encontrado', 404);

    return successResponse(job);
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao consultar job', 500);
  }
}
