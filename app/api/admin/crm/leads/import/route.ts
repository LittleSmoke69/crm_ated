import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_IMPORT = 5000;
const INSERT_BATCH = 500;

function normalizePhone(v: string | null | undefined): string {
  return String(v || '').replace(/\D/g, '');
}

/**
 * POST /api/admin/crm/leads/import — importa a base de leads (CSV parseado no cliente).
 * Body: { leads: [{ name?, phone?, email? }], gerente_id?, captador_id? }
 * Sem captador: entram como pendentes (fora do kanban). Com captador: já entram no kanban dele.
 * Duplicados por telefone NÃO são bloqueados (a tela marca "2ª vez"), mas linhas 100% vazias são ignoradas.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);
    const zaplotoId = await getEffectiveZaplotoId(req, profile);
    const body = await req.json().catch(() => ({}));

    const raw: any[] = Array.isArray(body.leads) ? body.leads : [];
    if (raw.length === 0) return errorResponse('Nenhum lead para importar.', 400);
    if (raw.length > MAX_IMPORT) {
      return errorResponse(`Máximo de ${MAX_IMPORT} leads por importação. Divida o arquivo.`, 400);
    }

    const gerenteId = body.gerente_id || null;
    const captadorId = body.captador_id || null;

    if (gerenteId) {
      const { data: g } = await supabaseServiceRole.from('profiles').select('id, status').eq('id', gerenteId).single();
      if (!g || g.status !== 'gerente') return errorResponse('Gerente inválido.', 400);
    }
    let captadorEnroller: string | null = null;
    if (captadorId) {
      const { data: c } = await supabaseServiceRole.from('profiles').select('id, status, enroller').eq('id', captadorId).single();
      if (!c || c.status !== 'captador') return errorResponse('Captador inválido.', 400);
      captadorEnroller = c.enroller || null;
    }

    const nowIso = new Date().toISOString();
    const base = Date.now() * 1000;
    const cleaned = raw
      .map((r, i) => ({
        name: typeof r.name === 'string' ? r.name.trim().slice(0, 200) : '',
        phone: normalizePhone(r.phone),
        email: typeof r.email === 'string' ? r.email.trim().toLowerCase().slice(0, 200) : '',
        idx: i,
      }))
      .filter((r) => r.name || r.phone || r.email);

    if (cleaned.length === 0) return errorResponse('Nenhuma linha válida (nome, telefone ou email).', 400);

    const rows = cleaned.map((r) => ({
      external_id: base + r.idx,
      user_id: captadorId,
      gerente_id: gerenteId || (captadorId ? captadorEnroller : null),
      name: r.name || null,
      phone: r.phone || null,
      email: r.email || null,
      status: 'novo',
      capture_status: 'pendente',
      source: 'import',
      zaploto_id: zaplotoId,
      assigned_by: captadorId ? userId : null,
      assigned_at: captadorId ? nowIso : null,
      created_at: nowIso,
      updated_at: nowIso,
    }));

    let inserted = 0;
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const batch = rows.slice(i, i + INSERT_BATCH);
      const { error } = await supabaseServiceRole.from('crm_leads').insert(batch);
      if (error) {
        return errorResponse(`Erro ao importar (após ${inserted} leads): ${error.message}`, 400);
      }
      inserted += batch.length;
    }

    // Com captador: posiciona todos na coluna inicial do kanban dele (lote direto, como o import do board)
    if (captadorId) {
      const { data: col } = await supabaseServiceRole
        .from('crm_columns')
        .select('id, key')
        .eq('zaploto_id', zaplotoId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (col?.id) {
        const stageRows = rows.map((r, i) => ({
          lead_external_id: String(r.external_id),
          user_id: captadorId,
          column_id: col.id,
          column_key: col.key,
          position: i,
          is_manual: true,
          moved_by: userId,
          moved_at: nowIso,
          updated_at: nowIso,
        }));
        for (let i = 0; i < stageRows.length; i += INSERT_BATCH) {
          await supabaseServiceRole.from('crm_lead_stage').insert(stageRows.slice(i, i + INSERT_BATCH));
        }
      }
    }

    return successResponse(
      { imported: inserted, skipped: raw.length - cleaned.length },
      `${inserted} lead(s) importado(s)${raw.length - cleaned.length > 0 ? `, ${raw.length - cleaned.length} linha(s) vazia(s) ignorada(s)` : ''}.`
    );
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
