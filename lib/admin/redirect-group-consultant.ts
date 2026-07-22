import { getBancasDoUsuario } from '@/lib/crm/user-bancas';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Colunas base de redirect_groups (sem consultant_user_id). */
export const REDIRECT_GROUPS_COLUMNS_BASE =
  'id, name, invite_url, weight_percent, is_active, created_at';

/** Erro do Postgres/PostgREST quando coluna (ex.: consultant_user_id) ainda não foi migrada. */
export function isMissingConsultantColumnError(err: { code?: string; message?: string } | null): boolean {
  const msg = (err?.message ?? '').toLowerCase();
  return (
    err?.code === '42703' ||
    msg.includes('consultant_user_id') ||
    (msg.includes('column') && msg.includes('does not exist'))
  );
}

export async function validateConsultantUserId(
  raw: unknown
): Promise<{ ok: true; id: string | null } | { ok: false; message: string }> {
  if (raw === null || raw === undefined || raw === '') return { ok: true, id: null };
  const id = String(raw).trim();
  if (!UUID_RE.test(id)) return { ok: false, message: 'consultant_user_id inválido' };
  const { data: prof } = await supabaseServiceRole.from('profiles').select('id').eq('id', id).maybeSingle();
  if (!prof) return { ok: false, message: 'Usuário não encontrado' };
  return { ok: true, id };
}

/** Lista todos os usuários para vincular consultor ao grupo (busca no picker). */
export async function fetchUsersForConsultantPicker(): Promise<
  { id: string; full_name: string | null; email: string | null; status: string | null }[]
> {
  const { data: profs, error } = await supabaseServiceRole
    .from('profiles')
    .select('id, full_name, email, status')
    .order('full_name', { ascending: true, nullsFirst: false })
    .limit(5000);
  if (error) {
    console.error('[fetchUsersForConsultantPicker]', error.message);
    return [];
  }
  return profs ?? [];
}

/** Consultores com perfil consultor vinculados à banca (user_bancas.banca_ids contém o UUID). */
export async function fetchConsultantsForBanca(
  bancaId: string
): Promise<{ id: string; full_name: string | null; email: string | null }[]> {
  let ubRows: { user_id: string }[] | null = null;
  /** jsonb @> — ver getUserIdsOnBanca em consultants: não usar .contains(..., [uuid]) (gera JSON inválido). */
  const q1 = await supabaseServiceRole
    .from('user_bancas')
    .select('user_id')
    .filter('banca_ids', 'cs', JSON.stringify([bancaId]));
  if (!q1.error) {
    ubRows = (q1.data ?? []) as { user_id: string }[];
  } else {
    console.warn('[fetchConsultantsForBanca] contains falhou, usando filtro em memória:', q1.error.message);
    const all = await supabaseServiceRole.from('user_bancas').select('user_id, banca_ids');
    if (all.error) {
      console.error('[fetchConsultantsForBanca] user_bancas', all.error.message);
      return [];
    }
    ubRows = (all.data ?? [])
      .filter((r: { banca_ids?: unknown }) => Array.isArray(r.banca_ids) && (r.banca_ids as string[]).includes(bancaId))
      .map((r: { user_id: string }) => ({ user_id: r.user_id }));
  }
  const uids = [...new Set((ubRows ?? []).map((r: { user_id: string }) => r.user_id))];
  if (uids.length === 0) return [];
  const { data: profs } = await supabaseServiceRole
    .from('profiles')
    .select('id, full_name, email')
    .in('id', uids)
    .eq('status', 'captador')
    .order('full_name', { ascending: true, nullsFirst: false });
  return profs ?? [];
}

export async function fetchConsultantsForProject(
  bancaId: string | null
): Promise<{ id: string; full_name: string | null; email: string | null }[]> {
  if (bancaId) return fetchConsultantsForBanca(bancaId);
  const { data: profs } = await supabaseServiceRole
    .from('profiles')
    .select('id, full_name, email')
    .eq('status', 'captador')
    .order('full_name', { ascending: true, nullsFirst: false })
    .limit(500);
  return profs ?? [];
}

/** Admin/super_admin podem vincular qualquer consultor; demais só consultores das próprias bancas (user_bancas). */
export function canAssignConsultorWithoutBancaCheck(profile: { status: string | null }): boolean {
  const s = String(profile.status ?? '').toLowerCase();
  return s === 'super_admin' || s === 'admin';
}

/** Verifica se o consultor compartilha ao menos uma banca com o gestor (interseção em user_bancas.banca_ids). */
export async function consultantBelongsToAnyUserBanca(
  consultantUserId: string,
  gestorUserId: string
): Promise<boolean> {
  const gestorBancas = await getBancasDoUsuario(gestorUserId);
  if (gestorBancas.length === 0) return false;
  const gestorBancaIds = new Set(gestorBancas.map((b) => b.id));

  const { data: row } = await supabaseServiceRole
    .from('user_bancas')
    .select('banca_ids')
    .eq('user_id', consultantUserId)
    .maybeSingle();
  const consultantBancaIds = Array.isArray(row?.banca_ids) ? (row.banca_ids as string[]) : [];
  return consultantBancaIds.some((id) => gestorBancaIds.has(id));
}

export async function assertConsultantAllowedForVslUser(
  consultantId: string | null,
  _profile: { status: string | null },
  _userId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!consultantId) return { ok: true };
  const chk = await validateConsultantUserId(consultantId);
  if (!chk.ok) return { ok: false, message: chk.message };
  return { ok: true };
}
