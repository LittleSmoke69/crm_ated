/**
 * POST /api/instances/verify-all
 * Verifica o status de todas as instâncias do usuário.
 * Se houver muitas instâncias ou demorar, processa em segundo plano e envia relatório via Loto Assistente ao concluir.
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { evolutionService } from '@/lib/services/evolution-service';
import { getSubordinates } from '@/lib/middleware/permissions';
import { sendVerificationReport } from '@/lib/services/loto-notify-service';

const TIMEOUT_PER_INSTANCE_MS = 8000;
const BATCH_SIZE = 5;
const SYNC_THRESHOLD = 6; // até este número, faz síncrono e retorna resultado; acima, dispara em background e retorna logo

function normalizeBaseUrl(baseUrl: string): string {
  if (!baseUrl) return '';
  return baseUrl.replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
}

function extractState(data: any): 'connected' | 'connecting' | 'disconnected' | 'unknown' {
  if (data?.base64 || data?.qrcode?.base64 || data?.qrcode) return 'connecting';
  const raw = (
    data?.instance?.state ??
    data?.instance?.status ??
    data?.state ??
    data?.connection?.state ??
    data?.status ??
    data?.data?.state ??
    data?.data?.status ??
    ''
  )
    .toString()
    .toLowerCase();
  if (!raw || raw === 'null' || raw === 'undefined' || raw === '') {
    if (data?.base64 || data?.qrcode) return 'connecting';
    return 'disconnected';
  }
  if (['open', 'connected', 'ready', 'online'].includes(raw)) return 'connected';
  if (['connecting', 'pairing', 'qrcode', 'qr', 'waiting_qr', 'waiting', 'pairing_code'].includes(raw)) return 'connecting';
  if (['close', 'closed', 'disconnected', 'logout', 'offline'].includes(raw)) return 'disconnected';
  return 'unknown';
}

async function checkOne(
  instance: { id: string; instance_name: string; status: string; phone_number?: string | null; user_id?: string },
  evolutionApi: { base_url: string; api_key_global: string }
): Promise<{ instance_name: string; phone: string; status: string; updated: boolean }> {
  const baseUrl = normalizeBaseUrl(evolutionApi.base_url);
  const url = `${baseUrl}/instance/connectionState/${instance.instance_name}`.replace(/([^:]\/)\/+/g, '$1');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_PER_INSTANCE_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { apikey: evolutionApi.api_key_global },
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await res.json().catch(() => ({}));
    const state = extractState(data);
    const newStatus = state === 'connected' ? 'ok' : state === 'connecting' ? 'connecting' : 'disconnected';
    const updated = newStatus !== instance.status;
    if (updated) {
      await supabaseServiceRole
        .from('evolution_instances')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', instance.id);
    }
    const statusLabel = newStatus === 'ok' ? 'Conectada' : newStatus === 'connecting' ? 'Conectando' : 'Desconectada';
    return {
      instance_name: instance.instance_name,
      phone: instance.phone_number || '-',
      status: statusLabel,
      updated,
    };
  } catch (e) {
    clearTimeout(timeoutId);
    const newStatus = 'disconnected';
    const updated = instance.status !== newStatus;
    if (updated) {
      await supabaseServiceRole
        .from('evolution_instances')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', instance.id);
    }
    return {
      instance_name: instance.instance_name,
      phone: instance.phone_number || '-',
      status: 'Desconectada (erro)',
      updated,
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();
    const isAdmin = profile?.status === 'admin';
    const isDonoBanca = profile?.status === 'dono_banca';
    const isGerente = profile?.status === 'gerente';
    let allowedUserIds: string[] = [userId];
    if (isDonoBanca || isGerente) {
      const subordinates = await getSubordinates(userId);
      allowedUserIds = [userId, ...subordinates.map((s: { id: string }) => s.id)];
    }

    let query = supabaseServiceRole
      .from('evolution_instances')
      .select(`
        id,
        instance_name,
        status,
        phone_number,
        user_id,
        evolution_apis!inner (
          id,
          base_url,
          api_key_global,
          is_active
        )
      `)
      .eq('is_active', true)
      .eq('evolution_apis.is_active', true)
      .not('evolution_apis.api_key_global', 'is', null);

    if (!isAdmin) query = query.in('user_id', allowedUserIds);
    const { data: instances, error: fetchErr } = await query.order('created_at', { ascending: false });

    if (fetchErr || !instances?.length) {
      return successResponse(
        { results: [], message: 'Nenhuma instância ativa para verificar.', reportSent: false },
        'Nenhuma instância para verificar'
      );
    }

    const list = instances as any[];
    const withApi = list
      .map((inst) => {
        const apis = inst.evolution_apis;
        const evolutionApi = Array.isArray(apis) ? apis[0] : apis;
        return {
          id: inst.id,
          instance_name: inst.instance_name,
          status: inst.status,
          phone_number: inst.phone_number,
          user_id: inst.user_id,
          evolutionApi: evolutionApi ? { base_url: evolutionApi.base_url, api_key_global: evolutionApi.api_key_global } : null,
        };
      })
      .filter((i) => i.evolutionApi != null);

    const runVerification = async (): Promise<{ instance_name: string; phone: string; status: string; updated: boolean }[]> => {
      const results: { instance_name: string; phone: string; status: string; updated: boolean }[] = [];
      for (let i = 0; i < withApi.length; i += BATCH_SIZE) {
        const batch = withApi.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map((inst) => checkOne(inst, inst.evolutionApi!))
        );
        results.push(...batchResults);
      }
      return results;
    };

    if (withApi.length <= SYNC_THRESHOLD) {
      const results = await runVerification();
      const reportLines = results.map(
        (r) => `• ${r.instance_name} | ${r.phone} | ${r.status}`
      );
      sendVerificationReport({ userId, reportLines }).catch(() => {});
      return successResponse(
        { results, reportSent: true, message: 'Verificação concluída. Relatório enviado ao seu WhatsApp.' },
        'Verificação concluída'
      );
    }

    runVerification()
      .then((results) => {
        const reportLines = results.map(
          (r) => `• ${r.instance_name} | ${r.phone} | ${r.status}`
        );
        return sendVerificationReport({ userId, reportLines });
      })
      .catch((err) => console.error('[verify-all] Background verification error:', err));

    return successResponse(
      {
        results: [],
        reportSent: false,
        message: `Verificação de ${withApi.length} instâncias em segundo plano. Você receberá o relatório no WhatsApp quando concluir.`,
        processing: true,
      },
      'Verificação em segundo plano'
    );
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
