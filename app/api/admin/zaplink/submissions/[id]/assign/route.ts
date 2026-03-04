/**
 * POST /api/admin/zaplink/submissions/[id]/assign
 * Atribui submissão: cria consultor, atualiza submission, insere notification, dispara WhatsApp
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
    const { id: submissionId } = await params;

    const body = await req.json().catch(() => ({}));
    const bancaId = typeof body.banca_id === 'string' ? body.banca_id.trim() : '';
    const gerenteId = typeof body.gerente_id === 'string' ? body.gerente_id.trim() : '';

    if (!bancaId || !gerenteId) {
      return errorResponse('banca_id e gerente_id são obrigatórios', 400);
    }

    const { data: submission, error: subError } = await supabaseServiceRole
      .from('zaplink_form_submissions')
      .select('id, zaplink_form_id, full_name, email, phone, status')
      .eq('id', submissionId)
      .single();

    if (subError || !submission) {
      return errorResponse('Submissão não encontrada', 404);
    }

    if (submission.status !== 'pending') {
      return errorResponse('Submissão já foi atribuída', 400);
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

    const { data: existing } = await supabaseServiceRole
      .from('profiles')
      .select('id, user_id, email, full_name, status, enroller')
      .eq('email', submission.email.trim().toLowerCase())
      .maybeSingle();

    const assignedAt = new Date().toISOString();
    let consultorToUse: { id: string; user_id?: string; email: string; full_name: string | null; status: string; enroller: string | null };

    if (existing) {
      // Usuário já cadastrado: ignora criação e vincula a submissão ao consultor existente (atualiza enroller e banca)
      consultorToUse = existing as typeof consultorToUse;
      await supabaseServiceRole
        .from('profiles')
        .update({ enroller: gerenteId })
        .eq('id', existing.id);
      await supabaseServiceRole
        .from('user_bancas')
        .upsert(
          { user_id: existing.id, banca_ids: [bancaId] },
          { onConflict: 'user_id' }
        );
    } else {
      const password = generatePassword();
      const passwordHash = bcrypt.hashSync(password, bcrypt.genSaltSync(10));
      const newUserId = randomUUID();

      const { data: newUser, error: createError } = await supabaseServiceRole
        .from('profiles')
        .insert({
          user_id: newUserId,
          email: submission.email.trim().toLowerCase(),
          full_name: submission.full_name || null,
          password_hash: passwordHash,
          status: 'consultor',
          enroller: gerenteId,
          created_at: new Date().toISOString(),
        })
        .select('id, user_id, email, full_name, status, enroller')
        .single();

      if (createError || !newUser) {
        return errorResponse(`Erro ao criar consultor: ${createError?.message}`, 500);
      }

      await supabaseServiceRole
        .from('user_settings')
        .insert({
          user_id: newUser.id,
          max_leads_per_day: 50,
          max_instances: 2,
          is_active: true,
          created_at: new Date().toISOString(),
        });

      await supabaseServiceRole
        .from('user_bancas')
        .upsert(
          { user_id: newUser.id, banca_ids: [bancaId] },
          { onConflict: 'user_id' }
        );

      consultorToUse = newUser as typeof consultorToUse;

      // WhatsApp só para novo cadastro
      try {
        const evolution = await getLotoAssistenciaInstance();
        if (evolution) {
          const phoneNorm = normalizePhone(submission.phone);
          if (phoneNorm.length >= 12) {
            const numberOnly = phoneNorm.includes('@') ? phoneNorm.replace(/@.*$/, '') : phoneNorm;
            const bancaName = banca?.name || 'a banca';
            const gerenteName = gerente?.full_name || 'o gerente';
            const welcomeMsg = `Olá, ${submission.full_name}! Seu cadastro foi aprovado. Você foi atribuído à banca *${bancaName}* e seu gerente *${gerenteName}* entrará em contato em breve.`;
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
        console.error('[zaplink/assign] Erro ao enviar WhatsApp (Loto Assistência):', sendErr);
      }
    }

    await supabaseServiceRole
      .from('zaplink_form_submissions')
      .update({
        status: existing ? 'cadastrado' : 'assigned',
        banca_id: bancaId,
        gerente_id: gerenteId,
        consultor_user_id: consultorToUse.id,
        assigned_at: assignedAt,
      })
      .eq('id', submissionId);

    await supabaseServiceRole
      .from('zaplink_gerente_notifications')
      .insert({
        gerente_id: gerenteId,
        zaplink_submission_id: submissionId,
      });

    return successResponse(
      {
        consultor: consultorToUse,
        submission_id: submissionId,
        assigned_at: assignedAt,
        already_registered: !!existing,
      },
      existing ? 'Lead já cadastrado; atribuição vinculada ao consultor existente.' : 'Atribuído com sucesso'
    );
  } catch (e) {
    return serverErrorResponse(e);
  }
}
