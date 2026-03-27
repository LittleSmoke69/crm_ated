import { supabaseServiceRole } from '@/lib/services/supabase-service';

export type BancaRow = { id: string; name: string; url: string };

/**
 * Bancas (crm_bancas) atribuídas ao usuário via user_bancas.banca_ids.
 * Mesma lógica já usada no CRM / gestor.
 */
export async function getBancasDoUsuario(userId: string): Promise<BancaRow[]> {
  const { data: row, error } = await supabaseServiceRole
    .from('user_bancas')
    .select('banca_ids')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !Array.isArray(row?.banca_ids) || row.banca_ids.length === 0) return [];

  const bancaIds = row.banca_ids as string[];
  const { data: bancas, error: bancasError } = await supabaseServiceRole
    .from('crm_bancas')
    .select('id, name, url')
    .in('id', bancaIds)
    .order('name', { ascending: true });

  if (bancasError || !bancas?.length) return [];
  return bancas as BancaRow[];
}
