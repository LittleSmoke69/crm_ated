import { evolutionChatApiBodyIndicatesSessionDropped } from '@/lib/evolution/mark-instance-disconnected';

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

function normalizeEvolutionBaseUrl(baseUrl: string): string {
  let normalized = baseUrl.trim().replace(/\/+$/, '');
  normalized = normalized.replace(/([^:]\/)\/+/g, '$1');
  return normalized;
}

/** Log de API key sem expor valor completo (mesmo padrão de outros serviços Evolution). */
function maskApiKeyForLog(key: string): string {
  if (!key) return '(vazio)';
  if (key.length <= 10) return `(len=${key.length})`;
  return `${key.slice(0, 6)}…${key.slice(-4)} (len=${key.length})`;
}

const EVOLUTION_LOG_PREFIX = '[LIST_CLEANING][Evolution]';

/** Logs completos do JSON de retorno (útil no dev). Produção: defina LIST_CLEANING_LOG_EVOLUTION_BODY=1 */
function shouldLogEvolutionBody(): boolean {
  return (
    process.env.LIST_CLEANING_LOG_EVOLUTION_BODY === '1' ||
    process.env.NODE_ENV === 'development'
  );
}

const MAX_LOG_JSON_CHARS = 4500;

function safeJsonForLog(obj: unknown): string {
  try {
    const s = JSON.stringify(obj);
    if (s.length <= MAX_LOG_JSON_CHARS) return s;
    return `${s.slice(0, MAX_LOG_JSON_CHARS)}… (truncado, len=${s.length})`;
  } catch {
    return String(obj);
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Aceita array cru, { numbers }, { data }, { success, data }, forks EvoAI, etc. */
function extractEvolutionWhatsappNumberRows(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const o = asRecord(body);
  if (!o) return [];

  const tryKeys = ['data', 'numbers', 'response', 'results', 'payload', 'items', 'contacts'];
  for (const k of tryKeys) {
    const v = o[k];
    if (Array.isArray(v)) return v;
    const inner = asRecord(v);
    if (inner && Array.isArray(inner.numbers)) return inner.numbers;
  }

  const dataRec = asRecord(o.data);
  if (dataRec && Array.isArray(dataRec.numbers)) return dataRec.numbers;

  return [];
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

function extractPhoneDigitsFromRow(row: Record<string, unknown>): string {
  const direct = row.number ?? row.phone ?? row.phoneNumber ?? row.telefone ?? row.mobile;
  if (typeof direct === 'string' && direct.length > 0) return digitsOnly(direct);
  const jid = row.jid ?? row.remoteJid ?? row.remote_jid;
  if (typeof jid === 'string' && jid.includes('@')) {
    return digitsOnly(jid.split('@')[0] ?? '');
  }
  return '';
}

/** Evolution documenta `exists`; forks usam nomes alternativos ou string "true"/"false". */
function coerceExistsFromRow(row: Record<string, unknown>): boolean | undefined {
  const keys = [
    'exists',
    'isWhatsApp',
    'isRegistered',
    'onWhatsApp',
    'registered',
    'isUser',
    'inWhatsApp',
    'isInWhatsapp',
  ];
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'boolean') return v;
    if (v === true || v === false) return v;
    if (typeof v === 'string') {
      const low = v.toLowerCase();
      if (low === 'true' || low === '1' || low === 'yes') return true;
      if (low === 'false' || low === '0' || low === 'no') return false;
    }
    if (typeof v === 'number') {
      if (v === 1) return true;
      if (v === 0) return false;
    }
  }
  return undefined;
}

function pickRowForNormalizedPhone(rows: unknown[], normalizedPhone: string): Record<string, unknown> | null {
  const want = digitsOnly(normalizedPhone);
  const records: Record<string, unknown>[] = [];
  for (const r of rows) {
    const rec = asRecord(r);
    if (rec) records.push(rec);
  }
  if (records.length === 0) return null;
  const exact = records.find((rec) => extractPhoneDigitsFromRow(rec) === want);
  if (exact) return exact;
  /** Só um item: uso seguro. Vários sem casar dígitos → não assumir. */
  if (records.length === 1) return records[0];
  return null;
}

export interface EvolutionListCleaningCheckRaw {
  source: 'evolution_whatsapp_numbers';
  phone: string;
  checked_at: string;
  exists_defined: boolean;
  response_body?: unknown;
  error?: unknown;
  /** Sessão Evolution encerrada (ex.: Connection Closed) — pausar limpeza e marcar instância desconectada. */
  session_dropped?: boolean;
}

/**
 * Um número por requisição: POST direto à Evolution `/chat/whatsappNumbers/{instance}` com `numbers: [digits]`.
 */
export async function checkWhatsAppForListCleaningEvolution(
  instanceName: string,
  baseUrl: string,
  apiKey: string,
  phone: string
): Promise<{
  status: 'active' | 'inactive' | 'unknown';
  raw: EvolutionListCleaningCheckRaw;
}> {
  const normalized = normalizePhone(phone);
  const checkedAt = new Date().toISOString();
  const baseRaw: EvolutionListCleaningCheckRaw = {
    source: 'evolution_whatsapp_numbers',
    phone: normalized,
    checked_at: checkedAt,
    exists_defined: false,
  };

  const root = normalizeEvolutionBaseUrl(baseUrl);
  const pathInstance = encodeURIComponent(instanceName);
  const url = `${root}/chat/whatsappNumbers/${pathInstance}`.replace(/([^:]\/)\/+/g, '$1');

  try {
    const reqStarted = Date.now();
    if (process.env.NODE_ENV !== 'test') {
      let host = '';
      try {
        host = new URL(root).host;
      } catch {
        host = '(url inválida)';
      }
      console.info(
        `${EVOLUTION_LOG_PREFIX} request → POST /chat/whatsappNumbers/${instanceName}`,
        JSON.stringify({
          host,
          full_url: url,
          body: { numbers: [maskPhoneForLog(normalized)] },
          headers: {
            'Content-Type': 'application/json',
            apikey: maskApiKeyForLog(apiKey),
            accept: 'application/json',
          },
        })
      );
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
        accept: 'application/json',
      },
      body: JSON.stringify({ numbers: [normalized] }),
    });

    const contentType = res.headers.get('content-type') ?? '';
    const rawText = await res.text();
    let body: unknown = {};
    if (rawText.trim()) {
      try {
        body = JSON.parse(rawText) as unknown;
      } catch {
        body = {
          _non_json: true,
          content_type: contentType,
          preview: rawText.slice(0, 1200),
        };
      }
    }
    baseRaw.response_body = body;

    if (evolutionChatApiBodyIndicatesSessionDropped(body)) {
      baseRaw.session_dropped = true;
      baseRaw.error = { reason: 'evolution_session_closed' };
      if (process.env.NODE_ENV !== 'test') {
        console.warn(
          `${EVOLUTION_LOG_PREFIX} sessão Evolution encerrada — instância deve ser marcada como desconectada; limpeza de lista será pausada.`
        );
      }
      return {
        status: 'unknown',
        raw: { ...baseRaw, exists_defined: false },
      };
    }

    const rows = extractEvolutionWhatsappNumberRows(body);
    const matchRow = pickRowForNormalizedPhone(rows, normalized);
    const existsCoerced = matchRow ? coerceExistsFromRow(matchRow) : undefined;
    const elapsedMs = Date.now() - reqStarted;

    const topKeys =
      body !== null && typeof body === 'object' && !Array.isArray(body)
        ? Object.keys(body as object)
        : Array.isArray(body)
          ? [`[array:${(body as unknown[]).length}]`]
          : typeof body;

    const logBase = {
      http_status: res.status,
      content_type: contentType,
      ms: elapsedMs,
      phone_masked: maskPhoneForLog(normalized),
      top_level_keys: topKeys,
      rows_extracted: rows.length,
      row_matched: Boolean(matchRow),
      row_keys: matchRow ? Object.keys(matchRow) : [],
      parsed_exists: existsCoerced,
    };

    if (shouldLogEvolutionBody() && process.env.NODE_ENV !== 'test') {
      console.info(
        `${EVOLUTION_LOG_PREFIX} response_raw`,
        JSON.stringify({ ...logBase, body_json: safeJsonForLog(body) })
      );
    }

    if (existsCoerced === undefined) {
      baseRaw.error = res.ok
        ? {
            reason: 'exists_nao_parseado',
            rows: rows.length,
            match_keys: matchRow ? Object.keys(matchRow) : [],
          }
        : { http_status: res.status };
      if (process.env.NODE_ENV !== 'test') {
        console.warn(
          `${EVOLUTION_LOG_PREFIX} parse falhou → status indefinido (unknown)`,
          JSON.stringify({
            ...logBase,
            body_json: safeJsonForLog(body),
            hint: 'Confira se a Evolution retorna exists/isWhatsApp em boolean ou string; veja body_json.',
          })
        );
      }
      return { status: 'unknown', raw: { ...baseRaw, exists_defined: false } };
    }

    const exists = existsCoerced === true;
    baseRaw.exists_defined = true;
    if (process.env.NODE_ENV !== 'test') {
      console.info(
        `${EVOLUTION_LOG_PREFIX} resultado`,
        JSON.stringify({
          ...logBase,
          exists_final: exists,
          mapped_whatsapp_status: exists ? 'active' : 'inactive',
        })
      );
    }
    return {
      status: exists ? 'active' : 'inactive',
      raw: { ...baseRaw, exists_defined: true },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        `${EVOLUTION_LOG_PREFIX} fetch error`,
        JSON.stringify({ phone: maskPhoneForLog(normalized), error: msg })
      );
    }
    return {
      status: 'unknown',
      raw: {
        ...baseRaw,
        exists_defined: false,
        error: err instanceof Error ? err.message : err,
      },
    };
  }
}
