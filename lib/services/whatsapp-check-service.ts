/**
 * Serviço de verificação WhatsApp via Wasender API.
 * Contrato: resposta com data.exists === true (válido) ou data.exists === false (não válido).
 * Nunca logar WASENDER_API_KEY em console.
 */

const WASENDER_BASE_URL = 'https://www.wasenderapi.com';

const LOG_PREFIX = '[LIST_CLEANING]';

export interface WasenderCheckResult {
  phone: string;
  on_whatsapp: boolean;
  /** Indica se a API respondeu com exists definido (true/false); false em erro ou resposta malformada */
  exists_defined: boolean;
  source: 'wasender';
  checked_at: string;
  error?: unknown;
}

/**
 * Normaliza número: apenas dígitos.
 */
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').slice(0, 15);
}

/**
 * Mascara número para log (evitar expor completo).
 */
function maskPhoneForLog(phone: string): string {
  if (phone.length <= 6) return phone;
  return phone.slice(0, 4) + '…' + phone.slice(-3);
}

/** Descrição legível dos códigos HTTP que geram result=unknown. */
const HTTP_STATUS_DESCRIPTION: Record<number, string> = {
  429: 'Too Many Requests — limite de taxa da API excedido; aguardar e tentar de novo',
  401: 'Unauthorized — chave API inválida ou expirada',
  403: 'Forbidden — acesso negado pela API',
  404: 'Not Found — endpoint ou recurso não encontrado',
  500: 'Internal Server Error — erro no servidor da API',
  502: 'Bad Gateway — API indisponível ou em manutenção',
  503: 'Service Unavailable — API temporariamente indisponível',
};

function describeHttpStatus(status: number): string {
  const desc = HTTP_STATUS_DESCRIPTION[status];
  return desc ? `http_${status} (${desc})` : `http_${status}`;
}

/**
 * Gera descrição curta do motivo de status unknown para facilitar debug
 * (ex.: números que podem ser válidos mas a API retornou formato inesperado).
 */
function reasonForUnknown(
  res: Response,
  body: Record<string, unknown>,
  data: Record<string, unknown> | undefined,
  hasExists: boolean
): string {
  if (!res.ok) {
    return describeHttpStatus(res.status);
  }
  if (body?.success !== true) {
    return `success=${String(body?.success)}`;
  }
  if (!data || typeof data !== 'object') {
    return 'no_data';
  }
  if (!hasExists) {
    const dataKeys = Object.keys(data).slice(0, 8).join(',') || 'empty';
    return `data.exists_missing data_keys=[${dataKeys}]`;
  }
  return 'unknown';
}

/**
 * Verifica se o número está no WhatsApp via Wasender API.
 * GET https://www.wasenderapi.com/api/on-whatsapp/{phone}
 * Resposta esperada: { success: true, data: { exists: true | false } }.
 * - exists === true → número válido no WhatsApp.
 * - exists === false → número não válido.
 * - Qualquer outro caso (erro, sem data.exists) → tratado como unknown para não perder leads.
 */
export async function checkWhatsAppByWasender(phone: string): Promise<WasenderCheckResult> {
  const apiKey = process.env.WASENDER_API_KEY || '';
  const normalized = normalizePhone(phone);
  const checkedAt = new Date().toISOString();

  if (!apiKey) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`${LOG_PREFIX} WASENDER_API_KEY não configurada; phone=${maskPhoneForLog(normalized)}`);
    }
    return {
      phone: normalized,
      on_whatsapp: false,
      exists_defined: false,
      source: 'wasender',
      checked_at: checkedAt,
      error: 'WASENDER_API_KEY não configurada',
    };
  }

  const phoneForApi = `+${normalized}`;
  const url = `${WASENDER_BASE_URL}/api/on-whatsapp/${encodeURIComponent(phoneForApi)}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    accept: 'application/json',
  };

  try {
    const res = await fetch(url, { method: 'GET', headers });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const data = body?.data as Record<string, unknown> | undefined;
    const hasExists = data != null && typeof data.exists === 'boolean';
    const exists = hasExists ? (data as { exists: boolean }).exists === true : false;

    const result: WasenderCheckResult = {
      phone: normalized,
      on_whatsapp: hasExists && exists,
      exists_defined: hasExists,
      source: 'wasender',
      checked_at: checkedAt,
    };
    if (!hasExists && (body?.success !== true || !data)) {
      result.error = res.ok
        ? 'Resposta sem data.exists'
        : { status: res.status, body: body ?? 'parse failed' };
    }
    if (process.env.NODE_ENV !== 'test' && res.status === 429) {
      const reason = reasonForUnknown(res, body, data, hasExists);
      console.warn(`${LOG_PREFIX} [CRÍTICO] rate limit 429 phone=${maskPhoneForLog(normalized)} ${reason}`);
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`${LOG_PREFIX} check phone=${maskPhoneForLog(normalized)} error=${msg}`);
    }
    return {
      phone: normalized,
      on_whatsapp: false,
      exists_defined: false,
      source: 'wasender',
      checked_at: checkedAt,
      error: err instanceof Error ? err.message : err,
    };
  }
}

/**
 * Retorno para uso na Limpeza de Lista: mapeia apenas data.exists para status.
 * - data.exists === true → active (não perder lead).
 * - data.exists === false → inactive (não válido).
 * - Erro ou resposta sem exists → unknown (não marcar como inactive).
 */
export async function checkWhatsAppForListCleaning(phone: string): Promise<{
  status: 'active' | 'inactive' | 'unknown';
  raw: WasenderCheckResult;
}> {
  const result = await checkWhatsAppByWasender(phone);
  if (result.error || !result.exists_defined) {
    return { status: 'unknown', raw: result };
  }
  return {
    status: result.on_whatsapp ? 'active' : 'inactive',
    raw: result,
  };
}
