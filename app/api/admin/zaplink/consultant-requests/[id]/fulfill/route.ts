/**
 * POST /api/admin/zaplink/consultant-requests/[id]/fulfill
 * Atende a solicitação com submissões pendentes: aprova cada submissão (cria consultor,
 * vincula à banca/gerente da solicitação), registra no pedido e envia WhatsApp.
 * Body: { submission_ids: string[] } — IDs de zaplink_form_submissions com status=pending.
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { evolutionService } from '@/lib/services/evolution-service';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let p = '';
  for (let i = 0; i < 10; i++) p += chars[Math.floor(Math.random() * chars.length)];
  return p;
}

function normalizePhone(input: string): string {
  let num = (input || '').replace(/\D/g, '');
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
    const submissionIdsRaw = body.submission_ids;
    const submissionIds = Array.isArray(submissionIdsRaw)
      ? submissionIdsRaw.map((x: unknown) => String(x).trim()).filter(Boolean)
      : [];
    if (submissionIds.length === 0) {
      return errorResponse('Selecione ao menos uma submissão pendente para enviar ao gerente.', 400);
    }

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

    const { data: gerente } = await supabaseServiceRole
      .from('profiles')
      .select('id, full_name')
      .eq('id', gerenteId)
      .eq('status', 'gerente')
      .maybeSingle();
    const gerenteName = (gerente as { full_name?: string } | null)?.full_name ?? 'o gerente';

    const addedConsultantIds: string[] = [];
    let skipped = 0;

    for (const submissionId of submissionIds) {
      const { data: submission, error: subErr } = await supabaseServiceRole
        .from('zaplink_form_submissions')
        .select('id, full_name, email, phone, status')
        .eq('id', submissionId)
        .single();

      if (subErr || !submission) continue;
      if ((submission as { status: string }).status !== 'pending') {
        skipped += 1;
        continue;
      }

      const sub = submission as { id: string; full_name: string | null; email: string; phone: string };
      const emailNorm = sub.email.trim().toLowerCase();

      const { data: existingProfile } = await supabaseServiceRole
        .from('profiles')
        .select('id')
        .eq('email', emailNorm)
        .maybeSingle();
      if (existingProfile) {
        skipped += 1;
        continue;
      }

      const password = generatePassword();
      const passwordHash = bcrypt.hashSync(password, bcrypt.genSaltSync(10));
      const newUserId = randomUUID();

      const { data: newUser, error: createErr } = await supabaseServiceRole
        .from('profiles')
        .insert({
          user_id: newUserId,
          email: emailNorm,
          full_name: sub.full_name || null,
          telefone: (sub.phone || '').trim() || null,
          password_hash: passwordHash,
          status: 'consultor',
          enroller: gerenteId,
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (createErr || !newUser) continue;

      const newConsultorId = (newUser as { id: string }).id;

      await supabaseServiceRole
        .from('user_settings')
        .insert({
          user_id: newConsultorId,
          max_leads_per_day: 50,
          max_instances: 2,
          is_active: true,
          created_at: new Date().toISOString(),
        });

      await supabaseServiceRole
        .from('user_bancas')
        .upsert(
          { user_id: newConsultorId, banca_ids: [bancaId] },
          { onConflict: 'user_id' }
        );

      const assignedAt = new Date().toISOString();
      await supabaseServiceRole
        .from('zaplink_form_submissions')
        .update({
          status: 'assigned',
          banca_id: bancaId,
          gerente_id: gerenteId,
          consultor_user_id: newConsultorId,
          assigned_at: assignedAt,
        })
        .eq('id', submissionId);

      await supabaseServiceRole.from('zaplink_consultant_request_fulfillments').insert({
        request_id: requestId,
        consultant_user_id: newConsultorId,
      });

      await supabaseServiceRole.from('zaplink_gerente_notifications').insert({
        gerente_id: gerenteId,
        zaplink_submission_id: submissionId,
      });

      addedConsultantIds.push(newConsultorId);

      try {
        const evolution = await getLotoAssistenciaInstance();
        if (evolution && sub.phone) {
          const phoneNorm = normalizePhone(sub.phone);
          if (phoneNorm.length >= 12) {
            const numberOnly = phoneNorm.includes('@') ? phoneNorm.replace(/@.*$/, '') : phoneNorm;
            const welcomeMsg = `Olá, ${sub.full_name || 'consultor'}! Seu cadastro foi aprovado. Você foi atribuído à banca *${bancaName.replace(/\*/g, '')}* e seu gerente *${gerenteName}* entrará em contato em breve.`;
            await evolutionService.sendText(
              evolution.instance_name,
              evolution.apikey,
              evolution.base_url,
              numberOnly,
              welcomeMsg
            );
          }
        }
      } catch (sendErr) {
        console.error('[zaplink/fulfill] Erro ao enviar WhatsApp para submissão', submissionId, sendErr);
      }
    }

    if (addedConsultantIds.length === 0) {
      return errorResponse(
        skipped > 0
          ? 'Nenhuma submissão pôde ser aprovada (já atribuídas ou e-mail já cadastrado).'
          : 'Submissões não encontradas ou já atribuídas.',
        400
      );
    }

    const newQuantitySent = requestRow.quantity_sent + addedConsultantIds.length;
    await supabaseServiceRole
      .from('zaplink_consultant_requests')
      .update({ quantity_sent: newQuantitySent, updated_at: new Date().toISOString() })
      .eq('id', requestId);

    const msg =
      skipped > 0
        ? `${addedConsultantIds.length} submissão(ões) aprovada(s) e enviada(s) ao gerente. ${skipped} ignorada(s) (já atribuídas ou e-mail em uso).`
        : `${addedConsultantIds.length} submissão(ões) aprovada(s) e enviada(s) ao gerente. Total atendido: ${newQuantitySent} de ${requestRow.quantity_requested}.`;

    return successResponse(
      { quantity_sent: newQuantitySent, added: addedConsultantIds.length, skipped },
      msg
    );
  } catch (e) {
    return serverErrorResponse(e);
  }
}
