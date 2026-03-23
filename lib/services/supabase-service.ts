import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Validação das variáveis de ambiente obrigatórias
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  const missingVars: string[] = [];
  if (!supabaseUrl) missingVars.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!supabaseKey) missingVars.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  
  const errorMessage = `❌ Variáveis de ambiente obrigatórias não encontradas: ${missingVars.join(', ')}\n\n` +
    `Por favor, crie um arquivo .env.local na raiz do projeto com:\n` +
    `NEXT_PUBLIC_SUPABASE_URL=sua_url_aqui\n` +
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_chave_aqui\n\n` +
    `Você pode encontrar essas informações no dashboard do Supabase: Settings > API`;
  
  // Em desenvolvimento, mostra erro claro
  if (process.env.NODE_ENV === 'development') {
    console.error(errorMessage);
    throw new Error(errorMessage);
  }
  
  // Em produção, lança erro genérico
  throw new Error('Configuração do Supabase incompleta. Verifique as variáveis de ambiente.');
}

const resolvedSupabaseUrl: string = supabaseUrl;
const resolvedSupabaseAnonKey: string = supabaseKey;

export const supabase = createClient(resolvedSupabaseUrl, resolvedSupabaseAnonKey);

// Service Role: lazy + leitura no primeiro uso (Netlify/Next injetam env no runtime do handler;
// validar no import quebrava páginas mesmo com a variável correta no painel).
let _supabaseServiceRoleClient: SupabaseClient | null = null;

/** Lê env em runtime sem nome literal `process.env.FOO` (Next pode “congelar” como undefined no build se FOO não existir no CI). */
function getEnvRaw(name: string): string | undefined {
  const v = process.env[name];
  return typeof v === 'string' ? v.replace(/^\uFEFF/, '').trim() : undefined;
}

/**
 * Chave service role do Supabase (somente servidor).
 * Nomes montados dinamicamente para não serem apagados pelo bundle em build sem o segredo.
 */
function readServiceRoleKey(): string {
  const serviceRoleKeyName = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');
  const raw = getEnvRaw(serviceRoleKeyName);
  const key = raw && raw.length > 0 ? raw : '';
  if (!key) {
    const errorMessage =
      '❌ SUPABASE_SERVICE_ROLE_KEY não encontrada ou vazia no runtime do servidor. ' +
      'No Netlify: Environment variables → mesma variável no site que faz o deploy do Next → escopos Build + Functions + Runtime + Deploy previews (conforme UI) → salvar → **Clear cache and deploy site**. ' +
      'Confira também se não há aspas extras no valor e se o deploy é do site correto.';
    if (process.env.NODE_ENV === 'development') {
      console.error(errorMessage);
    }
    throw new Error(errorMessage);
  }
  return key;
}

function getOrCreateServiceRoleClient(): SupabaseClient {
  if (!_supabaseServiceRoleClient) {
    _supabaseServiceRoleClient = createClient(resolvedSupabaseUrl, readServiceRoleKey(), {
      auth: { persistSession: false },
    });
  }
  return _supabaseServiceRoleClient;
}

/** Cliente service role; só valida a chave na primeira chamada (ex.: `.from()`). */
export const supabaseServiceRole: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, _receiver) {
    const client = getOrCreateServiceRoleClient();
    const value = (client as unknown as Record<PropertyKey, unknown>)[prop];
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
});

