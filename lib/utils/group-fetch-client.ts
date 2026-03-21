/**
 * Cliente para POST /api/groups/fetch com suporte a job assíncrono (Netlify) + polling.
 */

async function parseJsonSafe(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  if (!contentType.includes('application/json')) {
    throw new Error('Resposta inválida do servidor. Verifique se está logado e tente novamente.');
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('Resposta inválida do servidor. Tente novamente.');
  }
}

export type GroupFetchJobRow = {
  id: string;
  status: string;
  error_message?: string | null;
  total_groups?: number | null;
  inserted_count?: number | null;
  updated_count?: number | null;
  message?: string | null;
};

export type GroupFetchEvolutionShape = {
  id: string;
  subject: string;
  pictureUrl?: string;
  size?: number;
};

export type GroupFetchResult = {
  groups: GroupFetchEvolutionShape[];
  message: string;
  asyncJob?: boolean;
};

/**
 * Busca grupos na Evolution, persiste no banco e devolve lista no formato usado pelos modais/páginas.
 */
export async function postGroupFetchAndResolve(
  userId: string,
  instanceName: string,
  options?: { pollIntervalMs?: number; maxWaitMs?: number },
): Promise<GroupFetchResult> {
  const pollIntervalMs = options?.pollIntervalMs ?? 2000;
  const maxWaitMs = options?.maxWaitMs ?? 900_000;

  const res = await fetch('/api/groups/fetch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
    },
    body: JSON.stringify({ instanceName }),
  });

  const body = await parseJsonSafe(res);
  if (!res.ok) {
    throw new Error((body.error as string) || (body.message as string) || 'Erro ao buscar grupos');
  }

  const data = body.data as Record<string, unknown> | unknown[] | undefined;
  const topMessage = (body.message as string) || '';

  if (data && typeof data === 'object' && !Array.isArray(data) && data.async && typeof data.jobId === 'string') {
    const jobId = data.jobId as string;
    const job = await pollGroupFetchJob(userId, jobId, pollIntervalMs, maxWaitMs);
    if (job.status === 'failed') {
      throw new Error(job.error_message || 'Falha ao buscar grupos na Evolution');
    }

    const gRes = await fetch(
      `/api/groups?instanceName=${encodeURIComponent(instanceName)}&evolutionShape=1`,
      { headers: { 'X-User-Id': userId } },
    );
    const gBody = await parseJsonSafe(gRes);
    if (!gRes.ok) {
      throw new Error((gBody.error as string) || 'Erro ao listar grupos após sincronização');
    }
    const groups = (Array.isArray(gBody.data) ? gBody.data : []) as GroupFetchEvolutionShape[];
    const msg = (job.message as string) || topMessage || `${groups.length} grupo(s) sincronizado(s)`;
    return { groups, message: msg, asyncJob: true };
  }

  const groups = (Array.isArray(data) ? data : []) as GroupFetchEvolutionShape[];
  return { groups, message: topMessage, asyncJob: false };
}

async function pollGroupFetchJob(
  userId: string,
  jobId: string,
  intervalMs: number,
  maxWaitMs: number,
): Promise<GroupFetchJobRow> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const r = await fetch(`/api/groups/fetch?jobId=${encodeURIComponent(jobId)}`, {
      headers: { 'X-User-Id': userId },
    });
    const j = await parseJsonSafe(r);
    if (!r.ok) {
      throw new Error((j.error as string) || 'Erro ao consultar status da busca');
    }
    const job = j.data as GroupFetchJobRow;
    if (job?.status === 'completed' || job?.status === 'failed') {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Tempo máximo de espera na sincronização de grupos excedido.');
}
