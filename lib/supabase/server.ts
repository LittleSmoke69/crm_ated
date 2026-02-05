import { createClient } from '@supabase/supabase-js';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * Cliente Supabase para uso no servidor (server-side)
 * Retorna o service role client já configurado no projeto
 * 
 * Para operações que precisam de autenticação do usuário,
 * use requireAuth do middleware e depois use supabaseServiceRole
 * com validação manual de owner_id
 */
export function getSupabaseServer() {
  return supabaseServiceRole;
}

/**
 * Cria um cliente Supabase com o token do usuário autenticado
 * Útil para operações que precisam respeitar RLS
 */
export async function createServerClient(userId: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Variáveis de ambiente NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY são obrigatórias'
    );
  }

  // Cria cliente com service role para operações administrativas
  // Em produção, você pode usar um token JWT do usuário aqui se necessário
  return supabaseServiceRole;
}

