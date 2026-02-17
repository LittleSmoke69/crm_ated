import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * Cliente Supabase com SERVICE_ROLE para uso exclusivo no servidor.
 * Nunca use no client; capi_access_token e outros segredos são acessados apenas aqui.
 */
export function createSupabaseAdminClient() {
  return supabaseServiceRole;
}
