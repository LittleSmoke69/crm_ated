import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const runtime = 'nodejs';
export const maxDuration = 60;

const EVOLUTION_TIMEOUT_MS = 20_000;
const DEFAULT_DELAY_MS = 1200;
const MIN_DELAY_MS = 0;
const MAX_DELAY_MS = 10_000;
const MIN_BASE64_LENGTH = 100;
const MAX_PTV_DURATION_SECONDS = 60;

/** Gera requestId para observabilidade (não logar video/apikey). */
function createRequestId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Normaliza "to" para uso na Evolution: aceita com/sem +, remove espaços/traços, formato numérico.
 * Se contém @g.us → grupo → retorna como está.
 * Senão → só dígitos, garante DDI 55, retorna 55DDDN@s.whatsapp.net.
 */
function normalizeTo(to: string): string {
  const trimmed = String(to ?? '').trim();
  if (!trimmed) return '';

  if (trimmed.includes('@g.us')) return trimmed;

  const digits = trimmed.replace(/\D/g, '');
  let number = digits;
  if (!number.startsWith('55') && number.length >= 10) {
    number = '55' + number;
  } else if (!number.startsWith('55')) {
    number = '55' + number;
  }
  return number ? `${number}@s.whatsapp.net` : '';
}

/**
 * Valida e normaliza delay: 0–10000 ms; fora do range ajusta para DEFAULT_DELAY_MS.
 */
function normalizeDelay(value: unknown): number {
  const n = typeof value === 'number' && !Number.isNaN(value) ? value : DEFAULT_DELAY_MS;
  if (n < MIN_DELAY_MS) return DEFAULT_DELAY_MS;
  if (n > MAX_DELAY_MS) return DEFAULT_DELAY_MS;
  return Math.round(n);
}

/**
 * Valida campo video: URL deve começar com http(s); base64 string longa (>= 100 chars).
 */
function validateVideo(video: unknown): { valid: boolean; error?: string } {
  const s = typeof video === 'string' ? video.trim() : '';
  if (!s) return { valid: false, error: 'video é obrigatório' };

  const isUrl = /^https?:\/\//i.test(s);
  if (isUrl) return { valid: true };

  const isBase64 = s.length >= MIN_BASE64_LENGTH && /^[A-Za-z0-9+/=]+$/.test(s);
  if (isBase64) return { valid: true };

  return {
    valid: false,
    error: 'video deve ser uma URL (http ou https) ou uma string base64 com pelo menos 100 caracteres',
  };
}

type EvolutionConfig = { baseUrl: string; apiKey: string };

/**
 * Resolve base_url e api_key: primeiro do Supabase (por instance_name), senão ENV.
 */
async function getEvolutionConfig(instanceName: string): Promise<EvolutionConfig | null> {
  const { data: instance, error } = await supabaseServiceRole
    .from('evolution_instances')
    .select(
      `
      instance_name,
      apikey,
      evolution_apis!inner ( id, base_url, api_key_global, is_active )
    `
    )
    .eq('instance_name', instanceName)
    .eq('is_active', true)
    .eq('evolution_apis.is_active', true)
    .maybeSingle();

  if (error || !instance) return null;

  const evolutionApi = Array.isArray(instance.evolution_apis)
    ? instance.evolution_apis[0]
    : (instance as { evolution_apis?: { base_url?: string; api_key_global?: string } }).evolution_apis;
  const baseUrl = (evolutionApi?.base_url ?? '').trim().replace(/\/+$/, '');
  const apiKey =
    (instance as { apikey?: string }).apikey?.trim() ||
    (evolutionApi as { api_key_global?: string })?.api_key_global?.trim() ||
    '';

  if (!baseUrl || !apiKey) return null;

  return { baseUrl, apiKey };
}

function getEvolutionConfigFromEnv(): EvolutionConfig | null {
  const baseUrl = process.env.EVOLUTION_BASE_URL?.trim().replace(/\/+$/, '');
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

/**
 * POST /api/whatsapp/evolution/send-ptv
 * Envia vídeo de bolinha (PTV) via Evolution API — chamada EXCLUSIVA para sendPtv (nunca sendMedia).
 *
 * Body enviado para Evolution: apenas { number, video, delay }. Não envia mediatype, mimetype, fileName.
 *
 * Validações: vídeo deve ser quadrado (1:1); duração máxima recomendada 60s.
 * 404 da Evolution → EVOLUTION_VERSION_DOES_NOT_SUPPORT_PTV.
 */
export async function POST(req: NextRequest) {
  const requestId = createRequestId();

  try {
    await requireAuth(req);
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Não autenticado', details: 'Header Authorization: Bearer <userId> ou sessão válida' },
      { status: 401 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Body inválido', details: 'JSON inválido' },
      { status: 400 }
    );
  }

  const instanceName = typeof body.instance === 'string' ? body.instance.trim() : '';
  const toInput = body.to;
  const videoInput = body.video;
  const delayInput = body.delay;
  const width = typeof body.width === 'number' && !Number.isNaN(body.width) ? body.width : undefined;
  const height = typeof body.height === 'number' && !Number.isNaN(body.height) ? body.height : undefined;
  const durationSeconds = typeof body.durationSeconds === 'number' && !Number.isNaN(body.durationSeconds) ? body.durationSeconds : undefined;

  // Validações obrigatórias
  if (!instanceName) {
    return NextResponse.json(
      { ok: false, error: 'Validação', details: 'instance é obrigatório' },
      { status: 400 }
    );
  }

  if (toInput === undefined || toInput === null || (typeof toInput === 'string' && !toInput.trim())) {
    return NextResponse.json(
      { ok: false, error: 'Validação', details: 'to é obrigatório' },
      { status: 400 }
    );
  }

  const toNormalized = normalizeTo(String(toInput).trim());
  if (!toNormalized) {
    return NextResponse.json(
      { ok: false, error: 'Validação', details: 'to inválido: informe número com DDI ou jid de grupo' },
      { status: 400 }
    );
  }

  const videoValidation = validateVideo(videoInput);
  if (!videoValidation.valid) {
    return NextResponse.json(
      { ok: false, error: 'Validação', details: videoValidation.error },
      { status: 400 }
    );
  }

  const video = typeof videoInput === 'string' ? videoInput.trim() : String(videoInput);
  const delay = normalizeDelay(delayInput);

  // PTV exige vídeo quadrado (1:1). Se width/height forem informados, validar.
  if (width !== undefined && height !== undefined) {
    const w = Math.round(Number(width));
    const h = Math.round(Number(height));
    if (w <= 0 || h <= 0) {
      return NextResponse.json(
        { ok: false, error: 'VIDEO_NOT_SQUARE_FOR_PTV', details: 'width e height devem ser positivos' },
        { status: 400 }
      );
    }
    if (w !== h) {
      return NextResponse.json(
        { ok: false, error: 'VIDEO_NOT_SQUARE_FOR_PTV', details: 'Vídeo de bolinha (PTV) deve ser quadrado (1:1)' },
        { status: 400 }
      );
    }
  }

  // Duração máxima recomendada: 60 segundos
  if (durationSeconds !== undefined && durationSeconds > MAX_PTV_DURATION_SECONDS) {
    return NextResponse.json(
      {
        ok: false,
        error: 'VIDEO_DURATION_EXCEEDS_RECOMMENDED',
        details: `Duração máxima recomendada para PTV é ${MAX_PTV_DURATION_SECONDS} segundos`,
      },
      { status: 400 }
    );
  }

  let config = await getEvolutionConfig(instanceName);
  if (!config) config = getEvolutionConfigFromEnv();
  if (!config) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Configuração',
        details:
          'Instância não encontrada no Supabase ou sem base_url/apikey. Configure EVOLUTION_BASE_URL e EVOLUTION_API_KEY no ambiente.',
      },
      { status: 400 }
    );
  }

  const evolutionUrl = `${config.baseUrl.replace(/([^:]\/)\/+/g, '$1')}/message/sendPtv/${encodeURIComponent(instanceName)}`;
  // Body EXCLUSIVO para sendPtv: apenas number, video, delay. NÃO enviar mediatype, mimetype, fileName.
  const evolutionBody = {
    number: toNormalized,
    video,
    delay,
  };

  const fetchWithTimeout = (): Promise<Response> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), EVOLUTION_TIMEOUT_MS);
    return fetch(evolutionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config!.apiKey,
      },
      body: JSON.stringify(evolutionBody),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));
  };

  let response: Response;
  try {
    response = await fetchWithTimeout();
  } catch (err: unknown) {
    const isRetryable =
      err instanceof Error &&
      (err.name === 'AbortError' || err.message?.includes('ECONNRESET') || err.message?.includes('ETIMEDOUT'));
    if (isRetryable) {
      try {
        response = await fetchWithTimeout();
      } catch (retryErr) {
        const message = retryErr instanceof Error ? retryErr.message : String(retryErr);
        const details = err instanceof Error ? err.message : String(err);
        console.warn('[send-ptv]', { instance: instanceName, to: toNormalized, requestId, error: details });
        return NextResponse.json(
          {
            ok: false,
            error: 'EVOLUTION_ERROR',
            details: `Falha de rede após retry: ${message}`,
            statusCode: 502,
            raw: undefined,
          },
          { status: 502 }
        );
      }
    } else {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[send-ptv]', { instance: instanceName, to: toNormalized, requestId, error: message });
      return NextResponse.json(
        {
          ok: false,
          error: 'EVOLUTION_ERROR',
          details: message,
          statusCode: 502,
          raw: undefined,
        },
        { status: 502 }
      );
    }
  }

  let raw: unknown;
  const text = await response.text();
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    raw = { raw: text };
  }

  if (response.status === 404) {
    console.warn('[send-ptv]', { instance: instanceName, to: toNormalized, statusCode: 404, requestId });
    return NextResponse.json(
      {
        ok: false,
        error: 'EVOLUTION_VERSION_DOES_NOT_SUPPORT_PTV',
        details: 'Endpoint sendPtv não disponível nessa versão da Evolution API. Atualize a Evolution.',
        statusCode: 404,
        raw,
      },
      { status: 502 }
    );
  }

  if (!response.ok) {
    console.warn('[send-ptv]', {
      instance: instanceName,
      to: toNormalized,
      statusCode: response.status,
      requestId,
    });
    const details =
      typeof raw === 'object' && raw !== null && 'message' in (raw as object)
        ? (raw as { message?: string }).message
        : typeof raw === 'object' && raw !== null && 'error' in (raw as object)
          ? (raw as { error?: string }).error
          : `Evolution API: ${response.status}`;
    return NextResponse.json(
      {
        ok: false,
        error: 'EVOLUTION_ERROR',
        details: String(details),
        statusCode: response.status,
        raw,
      },
      { status: 502 }
    );
  }

  console.info('[send-ptv]', {
    instance: instanceName,
    to: toNormalized,
    statusCode: response.status,
    requestId,
  });

  return NextResponse.json({
    ok: true,
    type: 'ptv',
    instance: instanceName,
    to: toNormalized,
    provider: 'evolution',
  });
}
