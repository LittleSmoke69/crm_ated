// src/utils/supaDebug.ts
export function logSupabaseError(context: string, err: unknown) {
  // supabase-js PostgrestError costuma ter: message, details, hint, code
  const asAny = err as any;
  // Tenta pegar o "error" retornado pelo método (err.message) e um payload completo
  console.group(`[SUPABASE][${context}]`);
  console.error('message:', asAny?.message);
  console.error('details:', asAny?.details);
  console.error('hint:', asAny?.hint);
  console.error('code:', asAny?.code);
  console.error('raw error object:', asAny);
  console.groupEnd();
}
