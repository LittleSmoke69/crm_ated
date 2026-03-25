import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const LOG_PREFIX = '[admin/crm/lead-requests][sync-consultor-names]';

type ConsultorRow = {
  consultor_id: string;
  quantity: number;
  consultor_name?: string;
  consultor_email?: string;
};

/**
 * POST /api/admin/crm/lead-requests/[id]/sync-consultor-names
 * Atualiza apenas esta solicitação: preenche consultor_name / consultor_email em `consultores` a partir de `profiles`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
    const { id } = await params;
    if (!id?.trim()) return errorResponse('ID da solicitação é obrigatório.', 400);

    const { data: row, error: fetchErr } = await supabaseServiceRole
      .from('gerente_lead_requests')
      .select('id, consultores')
      .eq('id', id.trim())
      .maybeSingle();

    if (fetchErr) {
      console.error(`${LOG_PREFIX} fetch error:`, fetchErr);
      return errorResponse('Erro ao buscar solicitação.', 500);
    }
    if (!row) return errorResponse('Solicitação não encontrada.', 404);

    const prev = (row.consultores as ConsultorRow[] | null) ?? [];
    const ids = [...new Set(prev.map((c) => String(c.consultor_id ?? '').trim()).filter(Boolean))];

    const namesById = new Map<string, string>();
    const emailsById = new Map<string, string>();
    if (ids.length > 0) {
      const { data: profiles, error: pErr } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email')
        .in('id', ids);
      if (pErr) {
        console.error(`${LOG_PREFIX} profiles error:`, pErr);
        return errorResponse('Erro ao buscar perfis dos consultores.', 500);
      }
      for (const p of profiles ?? []) {
        const name = (p.full_name ?? p.email ?? '').trim() || (p.email ?? p.id);
        namesById.set(p.id, name);
        if (p.email?.trim()) emailsById.set(p.id, p.email.trim());
      }
    }

    const next: ConsultorRow[] = prev.map((c) => {
      const cid = String(c.consultor_id ?? '').trim();
      const fromName = cid ? namesById.get(cid) : undefined;
      const fromEmail = cid ? emailsById.get(cid) : undefined;
      return {
        ...c,
        ...(fromName ? { consultor_name: fromName } : {}),
        ...(fromEmail ? { consultor_email: fromEmail } : {}),
      };
    });

    let entryDelta = 0;
    for (let i = 0; i < prev.length; i++) {
      const a = prev[i];
      const b = next[i];
      if (a.consultor_name !== b.consultor_name || a.consultor_email !== b.consultor_email) entryDelta += 1;
    }

    if (entryDelta === 0) {
      return successResponse(
        { id: row.id, updated: false, entriesTouched: 0 },
        namesById.size === 0 && ids.length > 0
          ? 'Nenhum perfil encontrado no cadastro para estes IDs de consultor.'
          : 'Nada a atualizar (dados já iguais ao cadastro).'
      );
    }

    const { error: upErr } = await supabaseServiceRole
      .from('gerente_lead_requests')
      .update({ consultores: next })
      .eq('id', row.id);

    if (upErr) {
      console.error(`${LOG_PREFIX} update error:`, upErr);
      return errorResponse('Erro ao gravar nomes dos consultores.', 500);
    }

    return successResponse(
      { id: row.id, updated: true, entriesTouched: entryDelta },
      'Nome(s) do(s) consultor(es) atualizado(s) nesta solicitação.'
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Acesso negado') || msg.includes('não tem permissão')) return errorResponse(msg, 403);
    console.error(`${LOG_PREFIX} Error:`, err);
    return serverErrorResponse(err);
  }
}
