/**
 * POST /api/groups/fetch/process
 * Processa um job de busca de grupos em segundo plano (chamado pelo cron ou trigger).
 * Não verifica acesso à instância (job já foi autorizado na criação). Timeout longo para muitos grupos.
 */
import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { normalizeGroupId } from '@/lib/utils/group-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min (Netlify/Vercel permitem até 300s em alguns planos)

const FETCH_TIMEOUT_MS = 280_000; // ~4,6 min (abaixo do maxDuration)

function normalizeBaseUrl(baseUrl: string): string {
  if (!baseUrl) return baseUrl;
  return baseUrl.trim().replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
}

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get('x-internal-cron-secret');
    if (secret !== process.env.CRON_SECRET || !process.env.CRON_SECRET) {
      return errorResponse('Não autorizado', 401);
    }

    const now = new Date().toISOString();

    const { data: jobs } = await supabaseServiceRole
      .from('group_fetch_jobs')
      .select('id, user_id, instance_name')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);

    const job = jobs?.[0];
    if (!job) {
      return successResponse({ processed: false, message: 'Nenhum job pendente' });
    }

    await supabaseServiceRole
      .from('group_fetch_jobs')
      .update({ status: 'processing', updated_at: now })
      .eq('id', job.id);

    const { data: instance, error: instanceError } = await supabaseServiceRole
      .from('evolution_instances')
      .select(`
        *,
        evolution_apis!inner (id, base_url, is_active)
      `)
      .eq('instance_name', job.instance_name)
      .eq('is_active', true)
      .single();

    if (instanceError || !instance?.apikey) {
      await supabaseServiceRole
        .from('group_fetch_jobs')
        .update({
          status: 'failed',
          error_message: 'Instância não encontrada ou sem apikey',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);
      return successResponse({ processed: true, job_id: job.id, status: 'failed' });
    }

    const evolutionApi = Array.isArray(instance.evolution_apis) ? instance.evolution_apis[0] : instance.evolution_apis;
    const baseUrl = evolutionApi?.base_url;
    if (!baseUrl) {
      await supabaseServiceRole
        .from('group_fetch_jobs')
        .update({
          status: 'failed',
          error_message: 'Evolution API sem base_url',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);
      return successResponse({ processed: true, job_id: job.id, status: 'failed' });
    }

    const url = `${normalizeBaseUrl(baseUrl)}/group/fetchAllGroups/${job.instance_name}?getParticipants=false`;
    console.log(`🔄 [GROUPS-JOB] Buscando grupos em segundo plano: ${job.instance_name} (timeout ${FETCH_TIMEOUT_MS / 1000}s)`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'GET',
        headers: { apikey: instance.apikey },
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timeoutId);
    } catch (err: any) {
      clearTimeout(timeoutId);
      const msg = err?.message ?? '';
      if (err.name === 'AbortError') {
        console.error(`⏱️ [GROUPS-JOB] Timeout após ${FETCH_TIMEOUT_MS}ms`);
        await supabaseServiceRole
          .from('group_fetch_jobs')
          .update({
            status: 'failed',
            error_message: `Timeout após ${FETCH_TIMEOUT_MS / 1000}s. A instância tem muitos grupos.`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id);
        return successResponse({ processed: true, job_id: job.id, status: 'failed' });
      }
      await supabaseServiceRole
        .from('group_fetch_jobs')
        .update({
          status: 'failed',
          error_message: msg || 'Erro de rede',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);
      return successResponse({ processed: true, job_id: job.id, status: 'failed' });
    }

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => '');
      await supabaseServiceRole
        .from('group_fetch_jobs')
        .update({
          status: 'failed',
          error_message: `API ${resp.status}: ${errorText.substring(0, 200)}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);
      return successResponse({ processed: true, job_id: job.id, status: 'failed' });
    }

    const json = await resp.json().catch(() => ({}));
    let groupsList: any[] = [];
    if (Array.isArray(json)) groupsList = json;
    else if (Array.isArray(json?.groups)) groupsList = json.groups;
    else if (Array.isArray(json?.data)) groupsList = json.data;
    else if (Array.isArray(json?.result)) groupsList = json.result;
    else if (json?.id && json?.subject) groupsList = [json];

    const normalized = new Map<string, { id: string; subject?: string; pictureUrl?: string; size?: number }>();
    for (const g of groupsList) {
      const rawId = g.id ?? g.remoteJid ?? g.group_id ?? '';
      const id = normalizeGroupId(rawId);
      if (!id) continue;
      if (!normalized.has(id)) {
        normalized.set(id, {
          id,
          subject: g.subject ?? g.group_subject ?? null,
          pictureUrl: g.pictureUrl ?? g.picture_url ?? null,
          size: g.size ?? null,
        });
      }
    }
    const uniqueGroups = Array.from(normalized.values());
    let inserted = 0;
    let updated = 0;

    for (const g of uniqueGroups) {
      const { data: existing } = await supabaseServiceRole
        .from('whatsapp_groups')
        .select('id, group_subject, picture_url, size')
        .eq('user_id', job.user_id)
        .eq('instance_name', job.instance_name)
        .eq('group_id', g.id)
        .limit(1)
        .maybeSingle();

      if (existing) {
        const subjectChanged = (existing.group_subject ?? null) !== (g.subject ?? null);
        const pictureChanged = (existing.picture_url ?? null) !== (g.pictureUrl ?? null);
        const sizeChanged = (existing.size ?? null) !== (g.size ?? null);
        if (subjectChanged || pictureChanged || sizeChanged) {
          const { error: updateError } = await supabaseServiceRole
            .from('whatsapp_groups')
            .update({
              group_subject: g.subject || null,
              picture_url: g.pictureUrl || null,
              size: g.size ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);
          if (!updateError) updated++;
        }
      } else {
        const { error: insertError } = await supabaseServiceRole
          .from('whatsapp_groups')
          .insert({
            user_id: job.user_id,
            instance_name: job.instance_name,
            group_id: g.id,
            group_subject: g.subject || null,
            picture_url: g.pictureUrl || null,
            size: g.size ?? null,
          });
        if (!insertError) inserted++;
        else if ((insertError as any).code === '23505') updated++;
      }
    }

    console.log(`✅ [GROUPS-JOB] Job ${job.id}: ${uniqueGroups.length} grupo(s), ${inserted} inseridos, ${updated} atualizados`);

    await supabaseServiceRole
      .from('group_fetch_jobs')
      .update({
        status: 'completed',
        groups_count: uniqueGroups.length,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    return successResponse({
      processed: true,
      job_id: job.id,
      status: 'completed',
      groups_count: uniqueGroups.length,
      inserted,
      updated,
    });
  } catch (e) {
    return serverErrorResponse(e);
  }
}
