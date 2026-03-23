import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getBancasDoUsuario } from '@/app/api/crm/bancas/route';

const CONTACT_SELECT =
  'id, name, telefone, horario, crm_sync_kind, crm_external_id, crm_snapshot, is_pinned_manual, updated_at';

type ContactRow = {
  crm_sync_kind?: string | null;
  crm_snapshot?: unknown;
  is_pinned_manual?: boolean | null;
};

/** Contatos vindos do CRM (kanban/transferidos) só aparecem se a banca do lead está em user_bancas do usuário. */
function contactVisibleForConsultorGerenteBancas(row: ContactRow, allowedBancaIds: Set<string>): boolean {
  if (row.is_pinned_manual === true || row.crm_sync_kind === 'manual') return true;
  const kind = row.crm_sync_kind;
  if (kind !== 'kanban' && kind !== 'transferred') return true;
  if (allowedBancaIds.size === 0) return false;
  const snap = row.crm_snapshot as { crm_banca_id?: string | null } | null | undefined;
  const bid = snap?.crm_banca_id;
  if (!bid) return true;
  return allowedBancaIds.has(bid);
}

/**
 * GET /api/chat/contacts?list=1 — lista todos os contatos do usuário (CRM + manuais), ordenados por atualização.
 * GET /api/chat/contacts?phone=5511999999999 — um contato por telefone (inclui snapshot CRM para o card).
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = new URL(req.url);

    if (searchParams.get('list') === '1') {
      const { data, error } = await supabaseServiceRole
        .from('chat_conversation_contacts')
        .select(CONTACT_SELECT)
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

      if (error) return errorResponse(error.message);
      const rows = (data ?? []) as ContactRow[];
      const profile = await getUserProfile(userId);
      const st = (profile?.status || '').toLowerCase();
      if (st === 'consultor' || st === 'gerente') {
        const assigned = await getBancasDoUsuario(userId);
        const allowedIds = new Set(assigned.map((b) => b.id));
        const filtered = rows.filter((r) => contactVisibleForConsultorGerenteBancas(r, allowedIds));
        return successResponse(filtered);
      }
      return successResponse(rows);
    }

    const phone = searchParams.get('phone');
    if (!phone) return errorResponse('phone é obrigatório (ou use list=1)', 400);

    const normalized = phone.replace(/\D/g, '');

    const { data: contact, error } = await supabaseServiceRole
      .from('chat_conversation_contacts')
      .select(CONTACT_SELECT)
      .eq('user_id', userId)
      .eq('telefone', normalized)
      .maybeSingle();

    if (error) return errorResponse(error.message);

    const c = contact as ContactRow | null;
    if (c) {
      const profile = await getUserProfile(userId);
      const st = (profile?.status || '').toLowerCase();
      if (st === 'consultor' || st === 'gerente') {
        const assigned = await getBancasDoUsuario(userId);
        const allowedIds = new Set(assigned.map((b) => b.id));
        if (!contactVisibleForConsultorGerenteBancas(c, allowedIds)) {
          return successResponse(null);
        }
      }
    }

    return successResponse(contact ?? null);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * POST /api/chat/contacts
 * Cria ou atualiza um contato (tabela chat_conversation_contacts) a partir do chat.
 * Body: { phone: string, name?: string, horario?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { phone, name, horario } = body as { phone?: string; name?: string; horario?: string };

    if (!phone) return errorResponse('phone é obrigatório', 400);

    const normalized = phone.replace(/\D/g, '');

    const { data: existing } = await supabaseServiceRole
      .from('chat_conversation_contacts')
      .select('id')
      .eq('user_id', userId)
      .eq('telefone', normalized)
      .maybeSingle();

    const now = new Date().toISOString();
    if (existing) {
      const { data, error } = await supabaseServiceRole
        .from('chat_conversation_contacts')
        .update({
          name: name ?? null,
          horario: horario ?? null,
          updated_at: now,
          crm_sync_kind: 'manual',
          is_pinned_manual: true,
        })
        .eq('id', existing.id)
        .select(CONTACT_SELECT)
        .single();

      if (error) return errorResponse(error.message);
      return successResponse(data);
    }

    const { data, error } = await supabaseServiceRole
      .from('chat_conversation_contacts')
      .insert({
        user_id: userId,
        telefone: normalized,
        name: name ?? null,
        horario: horario ?? null,
        crm_sync_kind: 'manual',
        is_pinned_manual: true,
        updated_at: now,
      })
      .select(CONTACT_SELECT)
      .single();

    if (error) return errorResponse(error.message);
    return successResponse(data, { message: 'Contato criado com sucesso' });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
