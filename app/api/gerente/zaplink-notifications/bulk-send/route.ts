/**
 * POST /api/gerente/zaplink-notifications/bulk-send
 * Envia mensagem via Evolution sendText para os telefones dos leads das submissões atribuídas
 * Usa notificações não vistas do gerente para obter os telefones
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

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['gerente']);

    const body = await req.json().catch(() => ({}));
    const message = typeof body.message === 'string' ? body.message.trim() : 'Olá! Seu cadastro foi realizado com sucesso. Em breve nosso consultor entrará em contato.';

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

    const evolution = await getLotoAssistenciaInstance();
    if (!evolution) {
      return errorResponse('Instância Loto Assistência não configurada', 503);
    }

    let sent = 0;
    for (const n of notifications) {
      const sub = n.zaplink_form_submissions as { full_name?: string; phone?: string } | null;
      if (!sub?.phone) continue;

      const phoneNorm = normalizePhone(sub.phone);
      if (phoneNorm.length < 12) continue;

      const remoteJid = phoneNorm.includes('@') ? phoneNorm : `${phoneNorm}@s.whatsapp.net`;
      const personalizedMsg = message.replace(/\{\{nome\}\}/g, sub.full_name || '');

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

    return successResponse({ sent }, `Mensagem enviada para ${sent} contato(s)`);
  } catch (e) {
    return serverErrorResponse(e);
  }
}
