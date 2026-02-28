import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { buildTagsReport, getConsultorsByBancaId } from '@/lib/services/tags-report-service';

/**
 * GET /api/admin/crm/reports/tags?banca_id=...&date_from=...&date_to=...
 * Relatório de etiquetas (uso por consultor + clientes recentemente etiquetados) para a banca.
 * Acesso: super_admin e admin.
 */
export async function GET(req: NextRequest) {
  try {
    await requireStatus(req, ['super_admin', 'admin']);

    const { searchParams } = req.nextUrl;
    const bancaId = searchParams.get('banca_id')?.trim() || null;
    const dateFrom = searchParams.get('date_from')?.trim() || null;
    const dateTo = searchParams.get('date_to')?.trim() || null;

    if (!bancaId) {
      return errorResponse('Parâmetro banca_id é obrigatório.', 400);
    }

    const consultores = await getConsultorsByBancaId(bancaId);
    const result = await buildTagsReport(consultores, dateFrom, dateTo);
    return successResponse(result);
  } catch (err: any) {
    console.error('[Admin CRM Reports Tags] Erro:', err);
    if (err.message?.includes('Não autenticado')) return errorResponse(err.message, 401);
    return serverErrorResponse(err);
  }
}
