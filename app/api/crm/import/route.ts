import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

type Incoming = { name?: string; phone?: string; email?: string };

// POST /api/crm/import — importa uma lista de contatos para uma coluna do funil
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json().catch(() => ({}));
    const columnKey = typeof body.column_key === 'string' && body.column_key ? body.column_key : 'novo';
    const raw = Array.isArray(body.contacts) ? (body.contacts as Incoming[]) : [];

    const contacts = raw
      .map((c) => ({
        name: typeof c.name === 'string' ? c.name.trim() : '',
        phone: typeof c.phone === 'string' ? c.phone.trim() : '',
        email: typeof c.email === 'string' ? c.email.trim() : '',
      }))
      .filter((c) => c.name || c.phone || c.email)
      .map((c) => ({
        name: c.name || c.phone || c.email,
        phone: c.phone,
        email: c.email,
      }))
      .slice(0, 2000);

    if (!contacts.length) return errorResponse('Nenhum contato válido para importar.', 400);

    // Coluna alvo
    const { data: col } = await supabaseServiceRole
      .from('crm_columns')
      .select('id, key')
      .eq('key', columnKey)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle();
    const column = col as { id: string; key: string } | null;
    if (!column) return errorResponse('Coluna alvo inexistente.', 400);

    // Insere os clientes (external_id único por índice dentro do lote)
    const base = Date.now();
    const leadRows = contacts.map((c, i) => ({
      external_id: base * 1000 + i,
      user_id: userId,
      name: c.name,
      phone: c.phone || null,
      email: c.email || null,
      status: 'novo',
    }));

    const { error: insErr } = await supabaseServiceRole.from('crm_leads').insert(leadRows);
    if (insErr) return errorResponse(`Erro ao importar: ${insErr.message}`, 500);

    // Posiciona cada cliente na coluna alvo (insere direto no estágio, em lote)
    const now = new Date().toISOString();
    const stageRows = leadRows.map((l, i) => ({
      lead_external_id: String(l.external_id),
      user_id: userId,
      column_id: column.id,
      column_key: column.key,
      position: i,
      is_manual: true,
      moved_by: userId,
      moved_at: now,
      updated_at: now,
    }));
    await supabaseServiceRole.from('crm_lead_stage').insert(stageRows);

    return successResponse({ imported: leadRows.length, column_key: column.key });
  } catch (err) {
    return serverErrorResponse(err);
  }
}
