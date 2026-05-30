import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Variáveis de ambiente NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY são obrigatórias'
  );
}

// Hard refuse to ship a service_role JWT to the browser. JWT payload is base64url
// (segundo segmento). Se aparecer role:service_role aqui, o app inteiro fica exposto.
{
  const payloadSegment = supabaseAnonKey.split('.')[1];
  if (payloadSegment) {
    try {
      const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
      const json = typeof atob === 'function'
        ? atob(base64)
        : Buffer.from(base64, 'base64').toString('utf-8');
      const parsed = JSON.parse(json) as { role?: string };
      if (parsed?.role === 'service_role') {
        throw new Error(
          'NEXT_PUBLIC_SUPABASE_ANON_KEY contém um JWT com role=service_role. ' +
          'Essa key é exposta ao browser e DEVE ser a chave anon. ' +
          'Rotacione a service_role no painel do Supabase e use a chave anon aqui.'
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('service_role')) throw err;
      // se o payload não for JSON válido, segue — não bloqueia em casos legítimos.
    }
  }
}

/**
 * Cliente Supabase para uso no browser (client-side)
 * Usa a chave anon key e respeita RLS
 */
export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

