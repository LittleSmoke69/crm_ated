/**
 * POST /api/admin/zaplink/consultant-requests/[id]/fulfill
 * Atende parcialmente ou totalmente: associa consultores à banca, registra no pedido
 * e envia mensagem WhatsApp (Loto Assistência) para cada consultor aprovado.
 * Body: { consultant_user_ids: string[] }
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { evolutionService } from '@/lib/services/evolution-service';

export const dynamic = 'force-dynamic';

function normalizePhone(input: string): string {
  let num = input.replace(/\D/g, '');
  if (num.length >= 10 && num.length <= 11 && !num.startsWith('55')) {
    num = '55' + num;
  }
  return num;
}

async function getLotoAssistenciaInstance(): Promise<{
  instance_name: string;
  apikey: string;
  base_url: string;
} | null> {
  const { data: row } = await supabaseServiceRole
    .from('system_settings')
    .select('value')
    .eq('key', 'loto_assistencia_instance_id')
    .maybeSingle();
  const instanceId = row?.value;
  if (!instanceId) return null;
  const { data: instance, error } = await supabaseServiceRole
    .from('evolution_instances')
    .select(`
      id,
      instance_name,
      apikey,
      evolution_apis ( base_url )
    `)
    .eq('id', instanceId)
    .single();
  if (error || !instance) return null;
  const apis = instance.evolution_apis as { base_url?: string } | { base_url?: string }[];
  const baseUrl = Array.isArray(apis) ? apis[0]?.base_url : apis?.base_url;
  if (!baseUrl || !instance.apikey) return null;
  return {
    instance_name: instance.instance_name,
    apikey: instance.apikey,
    base_url: baseUrl,
  };
}

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
      .select(`
        id,
        gerente_id,
        banca_id,
        quantity_requested,
        quantity_sent,
        crm_bancas ( name )
      `)
      .eq('id', requestId)
      .single();
    if (reqErr || !requestRow) return errorResponse('Solicitação não encontrada.', 404);
    const bancaId = requestRow.banca_id;
    const gerenteId = requestRow.gerente_id;
    const bancaName =
      (requestRow.crm_bancas as { name?: string } | null)?.name ??
      (Array.isArray(requestRow.crm_bancas) ? (requestRow.crm_bancas[0] as { name?: string })?.name : null) ??
      'a banca';

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
      if (gerenteId) {
        await supabaseServiceRole.from('profiles').update({ enroller: gerenteId }).eq('id', userId);
      }
    }

    const newQuantitySent = requestRow.quantity_sent + toAdd.length;
    await supabaseServiceRole
      .from('zaplink_consultant_requests')
      .update({ quantity_sent: newQuantitySent, updated_at: new Date().toISOString() })
      .eq('id', requestId);

    // Envia mensagem WhatsApp (Loto Assistência) para cada consultor aprovado. Falha no envio não afeta a resposta.
    try {
      const { data: profiles } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, telefone')
        .in('id', toAdd);
      const evolution = await getLotoAssistenciaInstance();
      if (evolution && profiles?.length) {
        const messageTemplate = `Olá, {{nome}}! Seu pedido de consultor foi aprovado. Você foi adicionado à banca *${bancaName.replace(/\*/g, '')}*. Em breve seu gerente entrará em contato.`;
        for (const p of profiles as { id: string; full_name: string | null; telefone: string | null }[]) {
          const phone = p?.telefone?.trim();
          if (!phone || phone.length < 10) continue;
          const phoneNorm = normalizePhone(phone);
          if (phoneNorm.length < 12) continue;
          const numberOnly = phoneNorm.includes('@') ? phoneNorm.replace(/@.*$/, '') : phoneNorm;
          const text = messageTemplate.replace(/\{\{nome\}\}/gi, p.full_name || '');
          try {
            await evolutionService.sendText(
              evolution.instance_name,
              evolution.apikey,
              evolution.base_url,
              numberOnly,
              text
            );
          } catch (sendErr) {
            console.error('[zaplink/consultant-requests/fulfill] Erro ao enviar WhatsApp para consultor', p.id, sendErr);
          }
        }
      }
    } catch (notifyErr) {
      console.error('[zaplink/consultant-requests/fulfill] Erro ao notificar consultores por WhatsApp:', notifyErr);
    }

    return successResponse(
      { quantity_sent: newQuantitySent, added: toAdd.length },
      `${toAdd.length} consultor(es) enviado(s). Total atendido: ${newQuantitySent} de ${requestRow.quantity_requested}.`
    );
  } catch (e) {
    return serverErrorResponse(e);
  }
}
