/**
 * POST /api/gerente/zaplink-notifications/bulk-send
 * Envia mensagem via Evolution sendText para os telefones dos leads das submissões atribuídas.
 * Usa a instância MESTRE do gerente (não Loto Assistência).
 * Loto Assistência é usada apenas para avisar quando um consultor é atribuído (banca e nome do gerente).
 */
import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { chatService } from '@/lib/services/chat-service';

export const dynamic = 'force-dynamic';

function normalizePhone(input: string): string {
  let num = input.replace(/\D/g, '');
  if (num.length >= 10 && num.length <= 11 && !num.startsWith('55')) {
    num = '55' + num;
  }
  return num;
}

type EvolutionConfig = { instance_name: string; apikey: string; base_url: string };

/** Retorna a instância mestre do gerente (conectada), para uso no disparo em massa. */
async function getGerenteMasterInstance(gerenteUserId: string): Promise<EvolutionConfig | null> {
  const { data: instance, error } = await supabaseServiceRole
    .from('evolution_instances')
    .select(`
      id,
      instance_name,
      apikey,
      evolution_apis ( base_url )
    `)
    .eq('user_id', gerenteUserId)
    .eq('is_master', true)
    .eq('is_active', true)
    .in('status', ['ok', 'open', 'connected'])
    .limit(1)
    .maybeSingle();

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

/** Retorna config da instância por nome e user_id (gerente). */
async function getGerenteInstanceByName(gerenteUserId: string, instanceName: string): Promise<EvolutionConfig | null> {
  const { data: instance, error } = await supabaseServiceRole
    .from('evolution_instances')
    .select(`
      id,
      instance_name,
      apikey,
      evolution_apis ( base_url )
    `)
    .eq('user_id', gerenteUserId)
    .eq('instance_name', instanceName)
    .eq('is_master', true)
    .eq('is_active', true)
    .in('status', ['ok', 'open', 'connected'])
    .maybeSingle();

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

export async function POST(req: NextRequest) {
  let userId: string | undefined;
  try {
    const auth = await requireStatus(req, ['gerente']);
    userId = auth.userId;

    const body = await req.json().catch(() => ({}));
    const message =
      typeof body.message === 'string' && body.message.trim()
        ? body.message.trim()
        : 'Olá, {{nome}}! Seu cadastro foi realizado com sucesso. Em breve nosso consultor entrará em contato.';
    const delayMinutes = Math.max(0, Number(body.delay_minutes) || 0);
    const delaySecs = Math.max(0, Number(body.delay_seconds) || 0);
    const delaySeconds = Math.min(3600, delayMinutes * 60 + delaySecs);
    const instanceName = typeof body.instance_name === 'string' ? body.instance_name.trim() : null;
    const sendTo = body.send_to === 'all_approved' ? 'all_approved' : 'unseen';

    type SubRow = { full_name?: string; phone?: string };
    let recipients: SubRow[] = [];

    if (sendTo === 'all_approved') {
      const { data: submissions, error: subError } = await supabaseServiceRole
        .from('zaplink_form_submissions')
        .select('full_name, phone')
        .eq('gerente_id', userId)
        .eq('status', 'assigned')
        .not('phone', 'is', null);
      if (subError) {
        return errorResponse('Erro ao buscar submissões aprovadas.', 500);
      }
      recipients = (submissions ?? []).map((s: SubRow) => ({ full_name: s.full_name, phone: s.phone }));
    } else {
      const { data: notifications, error: notifError } = await supabaseServiceRole
        .from('zaplink_gerente_notifications')
        .select(`
          id,
          zaplink_submission_id,
          zaplink_form_submissions ( full_name, phone )
        `)
        .eq('gerente_id', userId)
        .is('seen_at', null);
      if (notifError || !notifications || notifications.length === 0) {
        return successResponse({ sent: 0 }, 'Nenhuma notificação para disparar');
      }
      recipients = (notifications as { zaplink_form_submissions: SubRow | null }[])
        .map((n) => n.zaplink_form_submissions)
        .filter(Boolean) as SubRow[];
    }

    if (recipients.length === 0) {
      return successResponse(
        { sent: 0 },
        sendTo === 'all_approved' ? 'Nenhuma submissão aprovada para disparar.' : 'Nenhuma notificação para disparar.'
      );
    }

    const evolution = instanceName
      ? await getGerenteInstanceByName(userId, instanceName)
      : await getGerenteMasterInstance(userId);
    if (!evolution) {
      return errorResponse(
        instanceName
          ? 'Instância mestre selecionada não encontrada ou desconectada.'
          : 'Nenhuma instância mestre conectada encontrada para o seu usuário. Conecte uma instância mestre em Instâncias.',
        503
      );
    }

    const delayMs = delaySeconds * 1000;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    let sent = 0;
    let isFirst = true;
    for (const sub of recipients) {
      if (!sub?.phone) continue;
      if (!isFirst && delayMs > 0) await sleep(delayMs);
      isFirst = false;

      const phoneNorm = normalizePhone(sub.phone);
      if (phoneNorm.length < 12) continue;

      const remoteJid = phoneNorm.includes('@') ? phoneNorm : `${phoneNorm}@s.whatsapp.net`;
      const personalizedMsg = message.replace(/\{\{nome\}\}/gi, sub.full_name || '');

      try {
        await chatService.sendMessage(
          {
            instance_name: evolution.instance_name,
            apikey: evolution.apikey,
            base_url: evolution.base_url,
          },
          { remoteJid, type: 'text', text: personalizedMsg }
        );
        sent++;
      } catch (sendErr) {
        console.error('[zaplink/bulk-send] Erro ao enviar para', phoneNorm, sendErr);
      }
    }

    const messagePreview = message.slice(0, 200);
    await supabaseServiceRole.from('zaplink_bulk_send_log').insert({
      gerente_id: userId,
      sent_count: sent,
      message_preview: messagePreview,
      delay_seconds: delaySeconds,
      status: 'success',
    });

    return successResponse({ sent }, `Mensagem enviada para ${sent} contato(s)`);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    if (userId) {
      try {
        await supabaseServiceRole.from('zaplink_bulk_send_log').insert({
          gerente_id: userId,
          sent_count: 0,
          message_preview: errMsg.slice(0, 200),
          delay_seconds: 0,
          status: 'failed',
          error_message: errMsg.slice(0, 500),
        });
      } catch (_) {}
    }
    return serverErrorResponse(e);
  }
}
