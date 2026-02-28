import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { buildTagsReport, getConsultorsByBancaId } from '@/lib/services/tags-report-service';

function normalizeBancaUrl(url: string | null | undefined): string {
  if (!url) return '';
  const s = String(url).trim().replace(/^https?:\/\//i, '').replace(/\/api\/crm\/?/i, '').replace(/\/+$/, '').trim();
  return s ? `https://${s}`.toLowerCase() : '';
}

/**
 * GET /api/dono-banca/reports/tags?banca_id=...&date_from=...&date_to=...
 * Relatório de etiquetas (uso por consultor + clientes recentemente etiquetados) para a banca.
 * - dono_banca: banca_id opcional; se omitido, usa a banca do dono (banca_url no perfil).
 * - super_admin/admin: banca_id obrigatório.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireStatus(req, ['dono_banca', 'super_admin', 'admin']);
    const { searchParams } = req.nextUrl;
    const bancaIdParam = searchParams.get('banca_id')?.trim() || null;
    const dateFrom = searchParams.get('date_from')?.trim() || null;
    const dateTo = searchParams.get('date_to')?.trim() || null;

    const isAdminOrSuperAdmin = profile?.status === 'super_admin' || profile?.status === 'admin';

    let bancaId = bancaIdParam;

    if (!bancaId) {
      if (isAdminOrSuperAdmin) {
        return errorResponse('Para super_admin e admin é obrigatório informar banca_id na URL.', 400);
      }
      // Dono: resolve banca_id a partir do banca_url do perfil
      const { data: profileRow } = await supabaseServiceRole
        .from('profiles')
        .select('banca_url')
        .eq('id', userId)
        .single();
      const bancaUrl = profileRow?.banca_url;
      const normUrl = normalizeBancaUrl(bancaUrl);
      if (!normUrl) {
        return successResponse({ tagUsage: [], recentTaggedClients: [] });
      }
      const { data: bancas } = await supabaseServiceRole.from('crm_bancas').select('id, url');
      const match = (bancas || []).find((b: { url?: string }) => normalizeBancaUrl(b.url) === normUrl);
      if (!match) {
        return successResponse({ tagUsage: [], recentTaggedClients: [] });
      }
      bancaId = match.id;
    } else if (!isAdminOrSuperAdmin) {
      // Dono: garante que a banca pertence ao dono
      const { data: profileRow } = await supabaseServiceRole
        .from('profiles')
        .select('banca_url')
        .eq('id', userId)
        .single();
      const bancaUrl = profileRow?.banca_url;
      const normUrl = normalizeBancaUrl(bancaUrl);
      const { data: bancas } = await supabaseServiceRole.from('crm_bancas').select('id, url');
      const match = (bancas || []).find((b: { url?: string }) => normalizeBancaUrl(b.url) === normUrl);
      if (!match || match.id !== bancaId) {
        return errorResponse('Banca não encontrada ou sem permissão.', 403);
      }
    }

    const consultores = await getConsultorsByBancaId(bancaId);
    const result = await buildTagsReport(consultores, dateFrom, dateTo);
    return successResponse(result);
  } catch (err: any) {
    console.error('[Dono-banca Reports Tags] Erro:', err);
    if (err.message?.includes('Não autenticado')) return errorResponse(err.message, 401);
    return serverErrorResponse(err);
  }
}
