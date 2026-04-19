import type { PostgrestError } from '@supabase/supabase-js';

const DEFAULT_CHUNK = 1000;

/**
 * Agrega todas as páginas de um select Supabase usando paginação por cursor (keyset).
 * Evita drift de offset em tabelas com inserções concorrentes.
 *
 * @param fetchPage - função que recebe o último cursor visto e retorna a próxima página
 *   ordenada de forma estável (ex.: .order('id').gt('id', cursor).limit(chunkSize))
 * @param getCursor - extrai o valor de cursor da última linha retornada
 */
export async function fetchAllSupabasePagesCursor<T>(
  fetchPage: (cursor: string | null) => Promise<{ data: T[] | null; error: PostgrestError | null }>,
  getCursor: (row: T) => string
): Promise<{ data: T[]; error: PostgrestError | null }> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (;;) {
    const { data: batch, error } = await fetchPage(cursor);
    if (error) return { data: out, error };
    if (!batch?.length) break;
    out.push(...batch);
    cursor = getCursor(batch[batch.length - 1]);
  }
  return { data: out, error: null };
}

/**
 * Agrega todas as páginas de um select Supabase (PostgREST limita linhas por resposta; ex.: 100 ou 1000).
 * Avança pelo `offset += batch.length` até receber página vazia.
 *
 * @deprecated Prefira fetchAllSupabasePagesCursor para tabelas com escrita concorrente.
 */
export async function fetchAllSupabasePages<T>(
  fetchRange: (from: number, to: number) => Promise<{ data: T[] | null; error: PostgrestError | null }>,
  chunkSize = DEFAULT_CHUNK
): Promise<{ data: T[]; error: PostgrestError | null }> {
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const { data: batch, error } = await fetchRange(offset, offset + chunkSize - 1);
    if (error) return { data: out, error };
    if (!batch?.length) break;
    out.push(...batch);
    if (batch.length < chunkSize) break; // full page not returned — no more data
    offset += batch.length;
  }
  return { data: out, error: null };
}
