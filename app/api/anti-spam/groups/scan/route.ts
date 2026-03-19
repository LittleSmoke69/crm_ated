/**
 * POST /api/anti-spam/groups/scan
 * Inicia um scan assíncrono dos grupos monitorados.
 * Cria um job no banco e dispara o processamento em background via fire-and-forget.
 * Retorna { job_id, status: 'pending' } imediatamente — sem timeout na Netlify.
 *
 * GET /api/anti-spam/groups/scan?job_id=<uuid>
 * Polling de status do job. Retorna status + resultado quando concluído.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const LOG_PREFIX = '[anti-spam/scan]';

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
      console.warn(LOG_PREFIX, 'config_id ausente', { userId: userId?.slice(0, 8) });
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
      console.warn(LOG_PREFIX, 'config não encontrada', { configId, userId: userId?.slice(0, 8) });
      return errorResponse('Configuração não encontrada', 404);
    }

    // Cria o job no banco
    const { data: job, error: jobErr } = await supabaseServiceRole
      .from('anti_spam_scan_jobs')
      .insert({ config_id: configId, owner_id: userId, status: 'pending' })
      .select('id')
      .single();

    if (jobErr || !job) {
      console.error(LOG_PREFIX, 'erro ao criar job', { configId, jobErr });
      return errorResponse('Erro ao criar job de scan', 500);
    }

    // Fire-and-forget: dispara o processamento na rota interna.
    // A rota /process tem maxDuration=300 e roda independente desta conexão.
    const host = req.headers.get('host') ?? 'localhost:3000';
    const protocol = host.startsWith('localhost') ? 'http' : 'https';
    void fetch(`${protocol}://${host}/api/anti-spam/groups/scan/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': process.env.CRON_SECRET ?? '',
      },
      body: JSON.stringify({ job_id: job.id }),
    }).catch((err) => {
      // Loga mas não bloqueia — o job pode ser retomado via scheduler futuro
      console.error(LOG_PREFIX, 'falha ao disparar processo background', { job_id: job.id, err: err?.message });
    });

    console.log(LOG_PREFIX, 'job criado', { job_id: job.id, configId, userId: userId?.slice(0, 8) });

    return successResponse({ job_id: job.id, status: 'pending' });
  } catch (err: any) {
    console.error(LOG_PREFIX, 'erro', { message: err?.message });
    return errorResponse(err.message || 'Erro ao iniciar scan', 500);
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
      .from('anti_spam_scan_jobs')
      .select('id, status, result, error, created_at, updated_at')
      .eq('id', jobId)
      .eq('owner_id', userId)
      .single();

    if (error || !job) return errorResponse('Job não encontrado', 404);

    if (job.status === 'completed' && job.result) {
      const result = job.result as any;
      const summary = result?.summary ?? {};
      const groups: any[] = Array.isArray(result?.groups) ? result.groups : [];

      console.log(LOG_PREFIX, `[GET] job concluído`, {
        job_id: jobId,
        status: job.status,
        summary: {
          groups_scanned: summary.groups_scanned ?? 0,
          total_participants: summary.total_participants ?? 0,
          invalid_total: summary.invalid_total ?? 0,
          blacklisted_total: summary.blacklisted_total ?? 0,
        },
        groups: groups.map((g) => ({
          group_jid: g.group_jid,
          group_name: g.group_name ?? null,
          participants_total: g.participants_total ?? 0,
          invalid_count: g.invalid_count ?? 0,
          blacklisted_count: g.blacklisted_count ?? 0,
          fetch_error: g.fetch_error ?? null,
          sample_contacts: Array.isArray(g.contacts)
            ? g.contacts.slice(0, 3).map((c: any) => ({
                jid: c.jid,
                phone: c.phone,
                is_valid_br: c.is_valid_br,
                is_blacklisted: c.is_blacklisted,
              }))
            : [],
        })),
      });
    } else {
      console.log(LOG_PREFIX, `[GET] job polling`, {
        job_id: jobId,
        status: job.status,
        error: job.error ?? null,
        updated_at: job.updated_at,
      });
    }

    return successResponse(job);
  } catch (err: any) {
    console.error(LOG_PREFIX, 'erro ao consultar job', { message: err?.message });
    return errorResponse(err.message || 'Erro ao consultar job', 500);
  }
}
