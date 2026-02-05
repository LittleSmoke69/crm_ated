import { createClient } from '@supabase/supabase-js';

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

export const supabase = createClient(supabaseUrl, supabaseKey);

// Service Role para operações no backend
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseKey;

const supabaseServiceRole = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      persistSession: false,
    },
  }
);

export { supabaseServiceRole };

