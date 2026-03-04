/**
 * POST /api/admin/zaplink/consultant-requests/[id]/fulfill
 * Atende parcialmente ou totalmente: associa consultores à banca e registra no pedido.
 * Body: { consultant_user_ids: string[] }
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);
    const { id: requestId } = await params;
    const body = await req.json().catch(() => ({}));
    const raw = body.consultant_user_ids;
    const consultantUserIds = Array.isArray(raw)
      ? raw.map((x: unknown) => String(x).trim()).filter(Boolean)
      : [];
    if (consultantUserIds.length === 0) return errorResponse('Informe ao menos um consultor (consultant_user_ids).', 400);

    const { data: requestRow, error: reqErr } = await supabaseServiceRole
      .from('zaplink_consultant_requests')
      .select('id, banca_id, quantity_requested, quantity_sent')
      .eq('id', requestId)
      .single();
    if (reqErr || !requestRow) return errorResponse('Solicitação não encontrada.', 404);
    const bancaId = requestRow.banca_id;

    const existing = await supabaseServiceRole
      .from('zaplink_consultant_request_fulfillments')
      .select('consultant_user_id')
      .eq('request_id', requestId);
    const alreadySent = new Set((existing.data ?? []).map((r: { consultant_user_id: string }) => r.consultant_user_id));
    const toAdd = consultantUserIds.filter((id) => !alreadySent.has(id));
    if (toAdd.length === 0) return errorResponse('Todos os consultores informados já foram enviados nesta solicitação.', 400);

    for (const userId of toAdd) {
      const { data: ub } = await supabaseServiceRole.from('user_bancas').select('banca_ids').eq('user_id', userId).maybeSingle();
      const current = Array.isArray(ub?.banca_ids) ? (ub.banca_ids as string[]) : [];
      const bancaIdStr = String(bancaId);
      if (!current.includes(bancaIdStr)) {
        const next = [...current, bancaIdStr];
        await supabaseServiceRole.from('user_bancas').upsert({ user_id: userId, banca_ids: next }, { onConflict: 'user_id' });
      }
      await supabaseServiceRole.from('zaplink_consultant_request_fulfillments').insert({
        request_id: requestId,
        consultant_user_id: userId,
      });
    }

    const newQuantitySent = requestRow.quantity_sent + toAdd.length;
    await supabaseServiceRole
      .from('zaplink_consultant_requests')
      .update({ quantity_sent: newQuantitySent, updated_at: new Date().toISOString() })
      .eq('id', requestId);

    return successResponse(
      { quantity_sent: newQuantitySent, added: toAdd.length },
      `${toAdd.length} consultor(es) enviado(s). Total atendido: ${newQuantitySent} de ${requestRow.quantity_requested}.`
    );
  } catch (e) {
    return serverErrorResponse(e);
  }
}
