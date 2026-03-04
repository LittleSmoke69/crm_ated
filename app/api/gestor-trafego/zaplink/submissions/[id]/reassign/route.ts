/**
 * POST /api/gestor-trafego/zaplink/submissions/[id]/reassign
 * Move lead já atribuído para outra banca/gerente (apenas de formulário do gestor).
 */
import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
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

async function getLotoAssistenciaInstance() {
  const { data: row } = await supabaseServiceRole
    .from('system_settings')
    .select('value')
    .eq('key', 'loto_assistencia_instance_id')
    .maybeSingle();
  const instanceId = row?.value;
  if (!instanceId) return null;
  const { data: instance, error } = await supabaseServiceRole
    .from('evolution_instances')
    .select('id, instance_name, apikey, evolution_apis ( base_url )')
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
    const { userId } = await requireStatus(req, ['gestor']);
    const { id: submissionId } = await params;

    const body = await req.json().catch(() => ({}));
    const bancaId = typeof body.banca_id === 'string' ? body.banca_id.trim() : '';
    const gerenteId = typeof body.gerente_id === 'string' ? body.gerente_id.trim() : '';

    if (!bancaId || !gerenteId) {
      return errorResponse('banca_id e gerente_id são obrigatórios', 400);
    }

    const { data: submission, error: subError } = await supabaseServiceRole
      .from('zaplink_form_submissions')
      .select('id, zaplink_form_id, full_name, phone, status, consultor_user_id')
      .eq('id', submissionId)
      .single();

    if (subError || !submission) {
      return errorResponse('Submissão não encontrada', 404);
    }

    const { data: form } = await supabaseServiceRole
      .from('zaplink_forms')
      .select('id')
      .eq('id', submission.zaplink_form_id)
      .eq('gestor_trafego_user_id', userId)
      .single();

    if (!form) {
      return errorResponse('Submissão não pertence aos seus formulários', 403);
    }

    if (submission.status !== 'assigned' && submission.status !== 'cadastrado') {
      return errorResponse('Só é possível mover leads já atribuídos. Use Atribuir para pendentes.', 400);
    }

    const consultorId = submission.consultor_user_id;
    if (!consultorId) {
      return errorResponse('Submissão atribuída sem consultor vinculado.', 400);
    }

    const { data: gerente } = await supabaseServiceRole
      .from('profiles')
      .select('id, full_name')
      .eq('id', gerenteId)
      .eq('status', 'gerente')
      .single();

    if (!gerente) {
      return errorResponse('Gerente não encontrado', 400);
    }

    const { data: banca } = await supabaseServiceRole
      .from('crm_bancas')
      .select('id, name')
      .eq('id', bancaId)
      .single();

    if (!banca) {
      return errorResponse('Banca não encontrada', 400);
    }

    await supabaseServiceRole
      .from('zaplink_form_submissions')
      .update({
        banca_id: bancaId,
        gerente_id: gerenteId,
      })
      .eq('id', submissionId);

    await supabaseServiceRole
      .from('profiles')
      .update({ enroller: gerenteId })
      .eq('id', consultorId);

    await supabaseServiceRole
      .from('user_bancas')
      .upsert(
        { user_id: consultorId, banca_ids: [bancaId] },
        { onConflict: 'user_id' }
      );

    await supabaseServiceRole
      .from('zaplink_gerente_notifications')
      .update({ gerente_id: gerenteId })
      .eq('zaplink_submission_id', submissionId);

    try {
      const evolution = await getLotoAssistenciaInstance();
      if (evolution) {
        const phoneNorm = normalizePhone(submission.phone);
        if (phoneNorm.length >= 12) {
          const numberOnly = phoneNorm.includes('@') ? phoneNorm.replace(/@.*$/, '') : phoneNorm;
          const bancaName = banca?.name || 'a banca';
          const gerenteName = gerente?.full_name || 'o gerente';
          const msg = `Olá, ${submission.full_name}! Sua atribuição foi alterada. Você agora está na banca *${bancaName}* e seu gerente *${gerenteName}* entrará em contato em breve.`;
          await evolutionService.sendText(
            evolution.instance_name,
            evolution.apikey,
            evolution.base_url,
            numberOnly,
            msg
          );
        }
      }
    } catch (sendErr) {
      console.error('[gestor-trafego/zaplink/reassign] Erro ao enviar WhatsApp:', sendErr);
    }

    return successResponse(
      { submission_id: submissionId, banca_id: bancaId, gerente_id: gerenteId },
      'Lead movido com sucesso. O gerente e o lead foram notificados.'
    );
  } catch (e) {
    return serverErrorResponse(e);
  }
}
