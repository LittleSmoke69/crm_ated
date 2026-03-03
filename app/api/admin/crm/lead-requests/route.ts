import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const LEAD_TYPE_LABELS: Record<string, string> = {
  registered: 'Lead apenas cadastrado',
  with_balance: 'Lead que possui saldo na banca',
  has_won: 'Lead que já ganhou na plataforma',
  has_withdrawn: 'Lead que já sacou na plataforma',
};

/**
 * GET /api/admin/crm/lead-requests
 * Lista solicitações de leads dos gerentes (pending primeiro, depois por data).
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { data: rows, error } = await supabaseServiceRole
      .from('gerente_lead_requests')
      .select('id, gerente_id, gerente_name, lead_type, consultores, status, banca_id, source_consultant_id, source_consultant_email, approved_by_user_id, approved_at, created_at, approval_snapshot')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[admin/crm/lead-requests] GET error:', error);
      return errorResponse('Erro ao listar solicitações.', 500);
    }

    const list = (Array.isArray(rows) ? rows : []).sort((a: { status: string; created_at: string }, b: { status: string; created_at: string }) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return 1;
      return 0;
    });
    const bancaIds = [...new Set(list.map((r: { banca_id?: string | null }) => r.banca_id).filter(Boolean))] as string[];
    const bancaNamesById = new Map<string, string>();
    if (bancaIds.length > 0) {
      const { data: bancas } = await supabaseServiceRole
        .from('crm_bancas')
        .select('id, name, url')
        .in('id', bancaIds);
      (bancas ?? []).forEach((b: { id: string; name: string | null; url: string | null }) => {
        bancaNamesById.set(b.id, (b.name ?? b.url ?? b.id).trim() || b.id);
      });
    }
    const consultorIds = new Set<string>();
    list.forEach((r: { consultores?: { consultor_id: string }[] }) => {
      (r.consultores ?? []).forEach((c: { consultor_id: string }) => consultorIds.add(c.consultor_id));
    });
    const ids = Array.from(consultorIds);
    const namesById = new Map<string, string>();
    if (ids.length > 0) {
      const { data: profiles } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email')
        .in('id', ids);
      (profiles ?? []).forEach((p: { id: string; full_name: string | null; email: string | null }) => {
        const name = (p.full_name ?? p.email ?? '').trim() || (p.email ?? p.id);
        namesById.set(p.id, name);
      });
    }
    const withLabels = list.map((r: { lead_type: string; banca_id?: string | null; consultores?: { consultor_id: string; quantity: number }[] }) => {
      const types = (r.lead_type ?? '').split(',').map((t: string) => t.trim()).filter(Boolean);
      const lead_type_label = types.length > 0 ? types.map((t) => LEAD_TYPE_LABELS[t] ?? t).join(', ') : (LEAD_TYPE_LABELS[r.lead_type] ?? r.lead_type);
      const banca_name = r.banca_id ? (bancaNamesById.get(r.banca_id) ?? r.banca_id) : null;
      return {
        ...r,
        lead_type_label,
        banca_name: banca_name ?? undefined,
        consultores: (r.consultores ?? []).map((c: { consultor_id: string; quantity: number }) => ({
          ...c,
          consultor_name: namesById.get(c.consultor_id) ?? c.consultor_id,
        })),
      };
    });

    return successResponse(withLabels);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Acesso negado') || msg.includes('não tem permissão')) {
      return errorResponse(msg, 403);
    }
    return serverErrorResponse(err);
  }
}
