import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Normaliza o destino "to" para remoteJid (Evolution API).
 * - Se to contém @g.us → é grupo → usar como está.
 * - Senão → tratar como telefone: remover não numéricos, garantir DDI 55, montar 55DDDN@s.whatsapp.net
 */
function normalizeToRemoteJid(to: string): string {
  const trimmed = String(to || '').trim();
  if (!trimmed) return '';

  if (trimmed.includes('@g.us')) return trimmed;

  const digits = trimmed.replace(/\D/g, '');
  let number = digits;
  if (!number.startsWith('55') && number.length >= 10) {
    number = '55' + number;
  } else if (number.startsWith('55')) {
    number = number;
  } else {
    number = '55' + number;
  }
  return `${number}@s.whatsapp.net`;
}

/**
 * POST /api/whatsapp/send-ptv
 * Envia Vídeo de Bolinha (PTV) via Evolution API.
 *
 * Body:
 * {
 *   instance: string,
 *   to: string,           // telefone (557599999999) ou grupo (1203630...@g.us)
 *   video: string,        // URL pública ou base64 (preferir URL)
 *   caption?: string,
 *   mentionsEveryOne?: boolean,
 *   delay?: number        // default 1200
 * }
 */
export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const body = await req.json();
    const { instance: instanceName, to, video, delay } = body;

    if (!instanceName || !to || !video) {
      return errorResponse('instance, to e video são obrigatórios', 400);
    }

    const remoteJid = normalizeToRemoteJid(to);
    if (!remoteJid) {
      return errorResponse('Destino (to) inválido', 400);
    }

    const delayMs = typeof delay === 'number' && delay >= 0 ? delay : 1200;

    const { data: instance, error: instanceError } = await supabaseServiceRole
      .from('evolution_instances')
      .select(`
        *,
        evolution_apis!inner ( id, base_url, is_active )
      `)
      .eq('instance_name', instanceName)
      .eq('is_active', true)
      .single();

    if (instanceError || !instance) {
      return errorResponse('Instância não encontrada ou inativa', 404);
    }

    const evolutionApi = Array.isArray(instance.evolution_apis)
      ? instance.evolution_apis[0]
      : instance.evolution_apis;
    const baseUrl = (evolutionApi?.base_url || '').trim().replace(/\/+$/, '');
    const apiKey = instance.apikey;

    if (!baseUrl || !apiKey) {
      return errorResponse('Instância sem base_url ou apikey configurada', 400);
    }

    // Body EXCLUSIVO para sendPtv: apenas number, video, delay (não enviar mediatype, mimetype, fileName, caption, etc.)
    const payload = {
      number: remoteJid,
      video: video.trim(),
      delay: delayMs,
    };

    const url = `${baseUrl.replace(/([^:]\/)\/+/g, '$1')}/message/sendPtv/${instanceName}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      console.error('[send-ptv] Evolution API error:', response.status, data);
      return errorResponse(
        (data as any)?.message || (data as any)?.error || `Evolution API: ${response.status}`,
        response.status >= 500 ? 502 : 400
      );
    }

    return successResponse(data, 'PTV enviado com sucesso');
  } catch (err: any) {
    console.error('[send-ptv] Erro:', err);
    return serverErrorResponse(err);
  }
}
