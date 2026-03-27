import type { PostgrestError } from '@supabase/supabase-js';

const DEFAULT_CHUNK = 5000;

/**
 * Agrega todas as páginas de um select Supabase (PostgREST limita linhas por resposta; ex.: 100 ou 1000).
 * Avança pelo `offset += batch.length` até receber página vazia.
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
    offset += batch.length;
  }
  return { data: out, error: null };
}
