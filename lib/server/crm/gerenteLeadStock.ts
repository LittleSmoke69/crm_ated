/**
 * Estoque de leads por gerente (e-mail pool CRM por banca).
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';

export type GerenteStockPoolRow = {
  id: string;
  gerente_user_id: string;
  banca_id: string;
  pool_consultant_email: string;
  created_at?: string;
  updated_at?: string;
};

export async function getGerenteBancaIds(gerenteUserId: string): Promise<string[]> {
  const { data } = await supabaseServiceRole.from('user_bancas').select('banca_ids').eq('user_id', gerenteUserId).maybeSingle();
  const ids = Array.isArray(data?.banca_ids) ? (data!.banca_ids as string[]) : [];
  return ids.filter(Boolean);
}

export async function assertGerenteHasBanca(gerenteUserId: string, bancaId: string): Promise<boolean> {
  const ids = await getGerenteBancaIds(gerenteUserId);
  return ids.includes(bancaId);
}

/** IDs de perfis com status gerente que têm a banca em user_bancas (para escopo admin no estoque). */
export async function listGerenteUserIdsOnBanca(bancaId: string): Promise<string[]> {
  const { data: ubRows } = await supabaseServiceRole.from('user_bancas').select('user_id, banca_ids');
  const candidates = new Set<string>();
  for (const row of ubRows ?? []) {
    const arr = Array.isArray(row.banca_ids) ? (row.banca_ids as string[]) : [];
    if (arr.includes(bancaId)) candidates.add(row.user_id as string);
  }
  if (candidates.size === 0) return [];
  const { data: profs } = await supabaseServiceRole.from('profiles').select('id').in('id', [...candidates]).eq('status', 'gerente');
  return (profs ?? []).map((p: { id: string }) => p.id);
}

export async function getStockPoolForGerenteBanca(
  gerenteUserId: string,
  bancaId: string
): Promise<GerenteStockPoolRow | null> {
  const { data, error } = await supabaseServiceRole
    .from('gerente_lead_stock_pools')
    .select('id, gerente_user_id, banca_id, pool_consultant_email, created_at, updated_at')
    .eq('gerente_user_id', gerenteUserId)
    .eq('banca_id', bancaId)
    .maybeSingle();
  if (error || !data) return null;
  return data as GerenteStockPoolRow;
}

/**
 * E-mail CRM usado como estoque do gerente na banca:
 * 1) Linha em `gerente_lead_stock_pools` (override opcional, ex.: CRM diferente do login).
 * 2) Senão, e-mail do perfil do gerente (`profiles.email`), desde que status = gerente e vínculo com a banca.
 */
export async function resolveGerenteStockPoolEmail(gerenteUserId: string, bancaId: string): Promise<string | null> {
  const onBanca = await assertGerenteHasBanca(gerenteUserId, bancaId);
  if (!onBanca) return null;

  const row = await getStockPoolForGerenteBanca(gerenteUserId, bancaId);
  const fromTable = row?.pool_consultant_email?.trim();
  if (fromTable) return fromTable.toLowerCase();

  const { data: prof, error } = await supabaseServiceRole
    .from('profiles')
    .select('email, status')
    .eq('id', gerenteUserId)
    .maybeSingle();
  if (error || !prof?.email?.trim()) return null;
  if (prof.status !== 'gerente') return null;
  return prof.email.trim().toLowerCase();
}

export async function upsertStockPool(params: {
  gerente_user_id: string;
  banca_id: string;
  pool_consultant_email: string;
}): Promise<{ ok: true; row: GerenteStockPoolRow } | { ok: false; error: string }> {
  const email = params.pool_consultant_email.trim().toLowerCase();
  if (!email) return { ok: false, error: 'E-mail do estoque é obrigatório.' };

  const { data, error } = await supabaseServiceRole
    .from('gerente_lead_stock_pools')
    .upsert(
      {
        gerente_user_id: params.gerente_user_id,
        banca_id: params.banca_id,
        pool_consultant_email: email,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'gerente_user_id,banca_id' }
    )
    .select('id, gerente_user_id, banca_id, pool_consultant_email, created_at, updated_at')
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'Erro ao salvar estoque.' };
  }
  return { ok: true, row: data as GerenteStockPoolRow };
}

export async function listStockPoolsByBanca(bancaId: string): Promise<GerenteStockPoolRow[]> {
  const { data, error } = await supabaseServiceRole
    .from('gerente_lead_stock_pools')
    .select('id, gerente_user_id, banca_id, pool_consultant_email, created_at, updated_at')
    .eq('banca_id', bancaId)
    .order('updated_at', { ascending: false });
  if (error || !Array.isArray(data)) return [];
  return data as GerenteStockPoolRow[];
}

export async function deleteStockPool(id: string, bancaId: string): Promise<boolean> {
  const { error } = await supabaseServiceRole.from('gerente_lead_stock_pools').delete().eq('id', id).eq('banca_id', bancaId);
  return !error;
}

/** Consultor direto do gerente (status consultor, enroller = gerente). */
export async function getBancaCrmBaseForTransfer(
  bancaId: string
): Promise<{ bancaId: string; crmBaseUrl: string; bancaName?: string } | null> {
  const { data, error } = await supabaseServiceRole.from('crm_bancas').select('id, url, name').eq('id', bancaId).maybeSingle();
  if (error || !data?.url) return null;
  const url = String(data.url).trim().replace(/\/+$/, '');
  return { bancaId: data.id, crmBaseUrl: url, bancaName: data.name ?? undefined };
}

export async function isConsultantDirectReportOfGerente(gerenteUserId: string, consultantEmail: string): Promise<boolean> {
  const em = consultantEmail.trim().toLowerCase();
  const { data } = await supabaseServiceRole
    .from('profiles')
    .select('id')
    .ilike('email', em)
    .eq('enroller', gerenteUserId)
    .eq('status', 'consultor')
    .maybeSingle();
  return !!data?.id;
}

/**
 * Se o e-mail for de um gerente vinculado à banca, retorna o id — usado para enviar ao estoque CRM
 * em vez da “carteira consultor” do gerente em transferências admin padrão.
 */
export async function findGerenteUserIdIfEmailIsGerenteOnBanca(targetEmail: string, bancaId: string): Promise<string | null> {
  const em = targetEmail.trim().toLowerCase();
  if (!em) return null;
  const { data: prof, error } = await supabaseServiceRole.from('profiles').select('id, status').ilike('email', em).maybeSingle();
  if (error || !prof?.id || prof.status !== 'gerente') return null;
  const onBanca = await assertGerenteHasBanca(prof.id, bancaId);
  return onBanca ? prof.id : null;
}
