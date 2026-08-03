import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getConsultorsByManager } from '@/lib/utils/hierarchy';

export const dynamic = 'force-dynamic';

const WON_COLUMN_KEY_FALLBACKS = ['status_convertido', 'convertido', 'ganho'] as const;
const VENDA_TAG_LABELS = ['venda', 'venda fechada'];
const IN_CHUNK = 80;
const SCAN_PAGE = 1000;

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function normalizeLabel(v: string): string {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

async function resolveWonColumnKeys(): Promise<string[]> {
  const { data } = await supabaseServiceRole
    .from('crm_columns')
    .select('key, title')
    .eq('is_active', true);
  const keys = new Set<string>([...WON_COLUMN_KEY_FALLBACKS]);
  for (const c of data || []) {
    const key = String((c as { key?: string }).key || '');
    if (!key) continue;
    const titleN = normalizeLabel((c as { title?: string }).title || '');
    const keyN = normalizeLabel(key);
    if (
      titleN.includes('convertid') ||
      titleN.includes('venda fechada') ||
      titleN.includes('cliente ganho') ||
      keyN.includes('convertid') ||
      keyN === 'ganho' ||
      (keyN.includes('venda') && keyN.includes('fechad'))
    ) {
      keys.add(key);
    }
  }
  return [...keys];
}

/**
 * GET /api/gerente/captadores-vendas
 * Paridade com o kanban: Convertido (ou 1ª coluna se for Convertido) OU etiqueta Venda.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['gerente', 'admin', 'super_admin']);
    const gerenteId = req.nextUrl.searchParams.get('gerente_id') || userId;

    if (gerenteId !== userId) {
      const { profile } = await requireStatus(req, ['admin', 'super_admin']);
      if (!profile) throw new Error('Acesso negado.');
    }

    const captadores = await getConsultorsByManager(gerenteId);
    if (captadores.length === 0) {
      return successResponse({ captadores: [], summary: { total_leads: 0, total_vendas: 0, taxa_geral: 0 } });
    }

    const captadorIds = captadores.map((c) => c.id);
    const statsByCaptador = new Map<string, { total: number; vendas: number }>();
    for (const id of captadorIds) statsByCaptador.set(id, { total: 0, vendas: 0 });

    const { data: cols } = await supabaseServiceRole
      .from('crm_columns')
      .select('key, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    const firstKey = String((cols?.[0] as { key?: string } | undefined)?.key || 'novo');
    const wonKeys = new Set(await resolveWonColumnKeys());
    const defaultIsWon = wonKeys.has(firstKey);

    const leadPairs: { external_id: string; user_id: string }[] = [];
    for (const chunk of chunkArray(captadorIds, IN_CHUNK)) {
      let from = 0;
      for (;;) {
        const { data: leads } = await supabaseServiceRole
          .from('crm_leads')
          .select('external_id, user_id')
          .in('user_id', chunk)
          .range(from, from + SCAN_PAGE - 1);
        const batch = leads ?? [];
        for (const l of batch) {
          const row = l as { external_id: number | string; user_id: string };
          if (!row.user_id || !statsByCaptador.has(row.user_id)) continue;
          leadPairs.push({ external_id: String(row.external_id), user_id: row.user_id });
          statsByCaptador.get(row.user_id)!.total += 1;
        }
        if (batch.length < SCAN_PAGE) break;
        from += SCAN_PAGE;
      }
    }

    const stageByLeadUser = new Map<string, string>();
    for (const chunk of chunkArray(captadorIds, IN_CHUNK)) {
      let from = 0;
      for (;;) {
        const { data: stages } = await supabaseServiceRole
          .from('crm_lead_stage')
          .select('lead_external_id, user_id, column_key')
          .in('user_id', chunk)
          .range(from, from + SCAN_PAGE - 1);
        const batch = stages ?? [];
        for (const s of batch) {
          const row = s as { lead_external_id: string; user_id: string; column_key: string };
          stageByLeadUser.set(`${String(row.lead_external_id)}:${row.user_id}`, row.column_key);
        }
        if (batch.length < SCAN_PAGE) break;
        from += SCAN_PAGE;
      }
    }

    const wonLeadKeys = new Set<string>();
    for (const p of leadPairs) {
      const key = `${p.external_id}:${p.user_id}`;
      const col = stageByLeadUser.get(key) ?? (defaultIsWon ? firstKey : null);
      if (col && wonKeys.has(col)) wonLeadKeys.add(key);
    }

    const { data: allTags } = await supabaseServiceRole.from('crm_tags').select('id, label');
    const wanted = new Set(VENDA_TAG_LABELS);
    const vendaTagIds = (allTags || [])
      .filter((t: any) => wanted.has(normalizeLabel(t.label || '')))
      .map((t: any) => String(t.id));

    if (vendaTagIds.length > 0) {
      for (const chunk of chunkArray(captadorIds, IN_CHUNK)) {
        let from = 0;
        for (;;) {
          const { data: tags } = await supabaseServiceRole
            .from('crm_lead_tags')
            .select('lead_external_id, user_id')
            .in('user_id', chunk)
            .in('tag_id', vendaTagIds)
            .range(from, from + SCAN_PAGE - 1);
          const batch = tags ?? [];
          for (const t of batch) {
            const row = t as { lead_external_id: string; user_id: string };
            if (!statsByCaptador.has(row.user_id)) continue;
            wonLeadKeys.add(`${String(row.lead_external_id)}:${row.user_id}`);
          }
          if (batch.length < SCAN_PAGE) break;
          from += SCAN_PAGE;
        }
      }
    }

    for (const key of wonLeadKeys) {
      const uid = key.slice(key.lastIndexOf(':') + 1);
      const st = statsByCaptador.get(uid);
      if (st) st.vendas += 1;
    }

    let totalLeads = 0;
    let totalVendas = 0;
    const result = captadores.map((c) => {
      const st = statsByCaptador.get(c.id) ?? { total: 0, vendas: 0 };
      totalLeads += st.total;
      totalVendas += st.vendas;
      const taxa = st.total > 0 ? Math.round((st.vendas / st.total) * 1000) / 10 : 0;
      return {
        id: c.id,
        name: c.full_name?.trim() || c.email || c.id,
        email: c.email,
        total_leads: st.total,
        vendas_fechadas: st.vendas,
        taxa_vendas: taxa,
      };
    });

    result.sort((a, b) => b.taxa_vendas - a.taxa_vendas || b.vendas_fechadas - a.vendas_fechadas);

    const taxaGeral = totalLeads > 0 ? Math.round((totalVendas / totalLeads) * 1000) / 10 : 0;

    return successResponse({
      captadores: result,
      summary: {
        total_leads: totalLeads,
        total_vendas: totalVendas,
        taxa_geral: taxaGeral,
      },
    });
  } catch (err) {
    return serverErrorResponse(err);
  }
}
