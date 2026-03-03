/**
 * Client server-side para API de redistribuição de leads do CRM.
 * NUNCA importar no client (browser) - usa CRM_API_KEY.
 */

const DEFAULT_TIMEOUT_MS = 30000;
const LOG_PREFIX = '[lead-transfer][crm-client]';

function normalizeCrmBaseUrl(raw: string): string {
  let u = raw.trim().replace(/^https?:\/\//i, '').replace(/\/api\/crm\/?/i, '').replace(/\/+$/, '').trim();
  const base = u ? (u.startsWith('http') ? u : `https://${u}`) : '';
  return base ? base.replace(/\/+$/, '') : '';
}

export interface RedistributionLead {
  id: number | string;
  [key: string]: unknown;
}

export interface RedistributionLeadsResponse {
  success: boolean;
  /** CRM pode retornar leads no root ou em data */
  data?: RedistributionLead[];
  leads?: RedistributionLead[];
  message?: string;
  error?: string;
}

export interface RedistributionTagsResponse {
  success: boolean;
  data?: string[];
  tags?: string[];
  message?: string;
  error?: string;
}

export interface RedistributeLeadsBody {
  source_consultant_email: string;
  target_consultant_email: string;
  leads_ids: (number | string)[];
}

export interface RedistributeLeadsResponse {
  success: boolean;
  count?: number;
  message?: string;
  error?: string;
  data?: { count?: number; message?: string };
}

/** Resposta do CRM get-indicateds-by-consultant (dados detalhados por lead/indicado) */
export interface IndicatedDetail {
  id: number | string;
  name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  total_depositado?: number;
  total_apostado?: number;
  total_ganho?: number;
  total_saque?: number;
  status?: string | null;
  temperature?: string | null;
  balance?: number;
  available_withdraw?: number;
  last_deposit_at?: string | null;
  last_deposit_value?: number | null;
  created_at?: string | null;
  [key: string]: unknown;
}

export interface GetIndicatedsByConsultantResponse {
  success: boolean;
  message?: string;
  data?: IndicatedDetail[];
  pagination?: { current_page?: number; per_page?: string | number; total?: number; last_page?: number };
  error?: string;
}

export interface CrmRedistributionClientOptions {
  crmBaseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

/**
 * Cliente para endpoints de redistribuição do CRM.
 * Recebe base URL da banca e chave de API; faz requisições com header X-API-KEY.
 */
export class CrmRedistributionClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(options: CrmRedistributionClientOptions) {
    const normalized = normalizeCrmBaseUrl(options.crmBaseUrl);
    if (!normalized) {
      throw new Error('crmBaseUrl inválido ou vazio');
    }
    this.baseUrl = normalized;
    this.apiKey = options.apiKey?.trim()?.replace(/\s+/g, '') ?? '';
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!this.apiKey) {
      throw new Error('API key é obrigatória');
    }
  }

  private async fetch<T>(
    path: string,
    init: RequestInit & { method?: string; body?: string } = {}
  ): Promise<{ data: T; status: number }> {
    const base = this.baseUrl.replace(/\/+$/, '');
    const pathPart = path.startsWith('/') ? path : `/${path}`;
    const url = `${base}/api/crm${pathPart}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      console.log(`${LOG_PREFIX} fetch: ${init.method ?? 'GET'} ${url}`, init.body ? { bodyLength: init.body.length, bodyPreview: String(init.body).slice(0, 200) } : {});
      const res = await fetch(url, {
        ...init,
        headers: {
          'x-api-key': this.apiKey,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          ...init.headers,
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const text = await res.text();
      if (res.status !== 200) {
        console.log(`${LOG_PREFIX} fetch response non-200: url=${url}, status=${res.status}, statusText=${res.statusText}, bodyPreview=${text.slice(0, 500)}`);
      } else {
        console.log(`${LOG_PREFIX} fetch response 200: url=${url}, bodyLength=${text.length}`);
      }
      let data: T;
      try {
        data = text ? (JSON.parse(text) as T) : ({} as T);
      } catch {
        throw new Error(`Resposta inválida do CRM (${res.status}): ${text.slice(0, 200)}`);
      }

      return { data, status: res.status };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          throw new Error('Timeout ao comunicar com o CRM. Tente novamente.');
        }
        throw new Error(err.message || 'Erro ao comunicar com o CRM');
      }
      throw new Error('Erro inesperado ao comunicar com o CRM');
    }
  }

  /**
   * GET /api/crm/redistribution-leads
   * Query: source_consultant_email (obrigatório), days_inactive?, tag?, lead_types? (filtros do modal: registered, with_balance, has_won, has_withdrawn).
   * Se o CRM suportar lead_types, retorna já filtrado; caso contrário filtrar em memória.
   */
  async getRedistributionLeads(params: {
    source_consultant_email: string;
    days_inactive?: number;
    tag?: string;
    /** Filtros do modal de aprovação: registered | with_balance | has_won | has_withdrawn (enviados ao CRM se suportar) */
    lead_types?: string[];
  }): Promise<RedistributionLeadsResponse> {
    const search = new URLSearchParams();
    search.set('source_consultant_email', params.source_consultant_email.trim());
    if (params.days_inactive != null) search.set('days_inactive', String(params.days_inactive));
    if (params.tag != null && params.tag.trim()) search.set('tag', params.tag.trim());
    if (Array.isArray(params.lead_types) && params.lead_types.length > 0) {
      search.set('lead_types', params.lead_types.join(','));
    }

    const { data, status } = await this.fetch<RedistributionLeadsResponse>(
      `/redistribution-leads?${search.toString()}`
    );

    if (status !== 200) {
      const msg = (data as RedistributionLeadsResponse).error ?? (data as RedistributionLeadsResponse).message ?? `HTTP ${status}`;
      console.log(`${LOG_PREFIX} getRedistributionLeads failed: status=${status}, message=${msg}`, data);
      return { success: false, error: msg, message: msg };
    }

    const raw = data as RedistributionLeadsResponse;
    const leadsArray = Array.isArray(raw.leads) ? raw.leads : (raw.data ?? []);
    const count = leadsArray.length;
    console.log(`${LOG_PREFIX} getRedistributionLeads success: ${count} lead(s)`);
    return {
      success: raw.success,
      data: leadsArray,
      message: raw.message,
      error: raw.error,
    };
  }

  /**
   * GET /api/crm/redistribution-tags
   * Query: consultant_email (obrigatório)
   */
  async getRedistributionTags(params: { consultant_email: string }): Promise<RedistributionTagsResponse> {
    const search = new URLSearchParams();
    search.set('consultant_email', params.consultant_email.trim());
    const { data, status } = await this.fetch<RedistributionTagsResponse>(
      `/redistribution-tags?${search.toString()}`
    );

    if (status !== 200) {
      const msg = (data as RedistributionTagsResponse).error ?? (data as RedistributionTagsResponse).message ?? `HTTP ${status}`;
      console.log(`${LOG_PREFIX} getRedistributionTags failed: status=${status}, message=${msg}`, data);
      return { success: false, error: msg, message: msg };
    }

    const tags = (data as RedistributionTagsResponse).data ?? (data as RedistributionTagsResponse).tags ?? [];
    console.log(`${LOG_PREFIX} getRedistributionTags success: ${Array.isArray(tags) ? tags.length : 0} tag(s)`);
    return data as RedistributionTagsResponse;
  }

  /**
   * POST /api/crm/redistribute-leads
   * Body: source_consultant_email, target_consultant_email, leads_ids
   */
  async redistributeLeads(body: RedistributeLeadsBody): Promise<RedistributeLeadsResponse> {
    const { data, status } = await this.fetch<RedistributeLeadsResponse>('/redistribute-leads', {
      method: 'POST',
      body: JSON.stringify({
        source_consultant_email: body.source_consultant_email.trim(),
        target_consultant_email: body.target_consultant_email.trim(),
        leads_ids: body.leads_ids,
      }),
    });

    if (status !== 200) {
      const msg = (data as RedistributeLeadsResponse).error ?? (data as RedistributeLeadsResponse).message ?? `HTTP ${status}`;
      console.log(`${LOG_PREFIX} redistributeLeads failed: status=${status}, message=${msg}`, data);
      return { success: false, error: msg, message: msg };
    }

    const count = (data as RedistributeLeadsResponse).count ?? (data as RedistributeLeadsResponse).data?.count;
    console.log(`${LOG_PREFIX} redistributeLeads success: count=${count}, message=${(data as RedistributeLeadsResponse).message ?? 'n/a'}`);
    return data as RedistributeLeadsResponse;
  }

  /**
   * GET /api/crm/get-indicateds-by-consultant
   * Query: consultant (email), per_page, page (opcional), transferred_filter (yes|no), sort, direction, lead_types? (filtros do modal).
   * Retorna lista detalhada de indicados do consultor (para enriquecer leads por id).
   */
  async getIndicatedsByConsultant(
    consultantEmail: string,
    perPage: number = 2000,
    page: number = 1,
    options?: {
      transferredFilter?: 'yes' | 'no';
      sort?: string;
      direction?: string;
      /** Filtros do modal: registered | with_balance | has_won | has_withdrawn (enviados ao CRM se suportar) */
      leadTypes?: string[];
    }
  ): Promise<GetIndicatedsByConsultantResponse> {
    const search = new URLSearchParams();
    search.set('consultant', consultantEmail.trim());
    search.set('per_page', String(perPage));
    if (page > 1) search.set('page', String(page));
    if (options?.transferredFilter) search.set('transferred_filter', options.transferredFilter);
    if (options?.sort) search.set('sort', options.sort);
    if (options?.direction) search.set('direction', options.direction);
    if (Array.isArray(options?.leadTypes) && options.leadTypes.length > 0) {
      search.set('lead_types', options.leadTypes.join(','));
    }

    const { data, status } = await this.fetch<GetIndicatedsByConsultantResponse>(
      `/get-indicateds-by-consultant?${search.toString()}`
    );

    if (status !== 200) {
      const msg = (data as GetIndicatedsByConsultantResponse).error ?? (data as GetIndicatedsByConsultantResponse).message ?? `HTTP ${status}`;
      console.log(`${LOG_PREFIX} getIndicatedsByConsultant failed: status=${status}, message=${msg}`, data);
      return { success: false, error: msg, message: msg };
    }

    const raw = data as GetIndicatedsByConsultantResponse;
    const list = Array.isArray(raw.data) ? raw.data : [];
    console.log(`${LOG_PREFIX} getIndicatedsByConsultant success: ${list.length} indicated(s)`);
    return {
      success: raw.success,
      data: list,
      message: raw.message,
      pagination: raw.pagination,
      error: raw.error,
    };
  }
}

/**
 * Cria cliente de redistribuição usando variável de ambiente CRM_API_KEY.
 * Deve ser chamado apenas no server.
 */
export function createCrmRedistributionClient(crmBaseUrl: string): CrmRedistributionClient {
  const apiKey = process.env.CRM_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error('CRM_API_KEY não configurada no servidor');
  }
  return new CrmRedistributionClient({
    crmBaseUrl,
    apiKey: apiKey.trim(),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
}
