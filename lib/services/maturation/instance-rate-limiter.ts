/**
 * Rate limiter por instance_name (in-memory, escopo do processo).
 *
 * Por que in-memory + worker único é o desenho certo aqui:
 *   - Evolution API enforce rate limit por instance (não por IP global).
 *   - 1 worker com paralelismo controlado por instance é mais simples que
 *     N workers + Redis lock + consistent hashing.
 *   - Se precisar escalar para múltiplos workers no futuro, basta substituir
 *     o map por um adapter Redis (ioredis está disponível? não — saiu junto
 *     com o BullMQ. Adicionar de volta só quando necessário).
 *
 * Implementação: serializa por instância. Cada step espera o anterior da mesma
 * instância terminar, e depois ainda respeita `MIN_INTERVAL_MS_PER_INSTANCE`.
 */

const MIN_INTERVAL_MS_PER_INSTANCE = Number(
  process.env.MATURATION_MIN_INTERVAL_MS_PER_INSTANCE ?? 2000,
);

type InstanceState = {
  /** Promise da última operação enfileirada nesta instância. */
  tail: Promise<void>;
  /** Timestamp do último envio iniciado (ms). */
  lastStartedAt: number;
};

const states = new Map<string, InstanceState>();

/**
 * Executa `fn` respeitando o cooldown por instância.
 * Serializa execuções da mesma `instance_name` e garante intervalo mínimo
 * entre o início de uma e o início da próxima.
 */
export async function runPerInstance<T>(instance: string, fn: () => Promise<T>): Promise<T> {
  const state: InstanceState =
    states.get(instance) ?? { tail: Promise.resolve(), lastStartedAt: 0 };

  let resolveOuter!: (v: T | PromiseLike<T>) => void;
  let rejectOuter!: (e: unknown) => void;
  const outer = new Promise<T>((res, rej) => { resolveOuter = res; rejectOuter = rej; });

  // Encadeia esta execução depois do tail atual da instância.
  const next: Promise<void> = state.tail.then(async () => {
    const wait = MIN_INTERVAL_MS_PER_INSTANCE - (Date.now() - state.lastStartedAt);
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    state.lastStartedAt = Date.now();
    try {
      const result = await fn();
      resolveOuter(result);
    } catch (err) {
      rejectOuter(err);
    }
  });

  // Atualiza o tail SEM propagar erros (evita poison-pill que pararia a fila da instância).
  state.tail = next.catch(() => {});
  states.set(instance, state);

  return outer;
}

/**
 * Aumenta o cooldown da instância em resposta a 429/rate-limit observado.
 * Backoff exponencial bem simples — reseta naturalmente no próximo envio bem-sucedido.
 */
export async function penalize(instance: string, backoffMs: number): Promise<void> {
  const state = states.get(instance);
  if (!state) return;
  state.lastStartedAt = Date.now() + backoffMs - MIN_INTERVAL_MS_PER_INSTANCE;
}

/**
 * Limpa estado de instâncias que não são tocadas há mais de 10min.
 * Útil em deploys de longa duração com rotatividade de instâncias.
 */
export function pruneStale(maxAgeMs = 10 * 60_000): number {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const [name, state] of states.entries()) {
    if (state.lastStartedAt < cutoff) {
      states.delete(name);
      removed++;
    }
  }
  return removed;
}

export function getInstanceStats(): { instances: number } {
  return { instances: states.size };
}
