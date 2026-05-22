/**
 * POST /api/forgot-password/send-code
 * Gera código de 6 dígitos, salva em password_reset_codes e envia via Evolution (Loto Assistência).
 */
import { NextRequest } from 'next/server';
import { checkIpRateLimit } from '@/lib/server/ip-rate-limit';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { chatService } from '@/lib/services/chat-service';

const CODE_EXPIRY_MINUTES = 15;
const CODE_LENGTH = 6;

function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
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
  const apis = instance.evolution_apis as any;
  const baseUrl = Array.isArray(apis) ? apis[0]?.base_url : apis?.base_url;
  if (!baseUrl || !instance.apikey) return null;
  return {
    instance_name: instance.instance_name,
    apikey: instance.apikey,
    base_url: baseUrl,
  };
}

function normalizePhone(input: string): string {
  let num = input.replace(/\D/g, '');
  if (num.length >= 10 && num.length <= 11 && !num.startsWith('55')) {
    num = '55' + num;
  }
  return num;
}

export async function POST(req: NextRequest) {
  try {
    const rateLimited = checkIpRateLimit(req, 'forgot-send-code', 8, 15 * 60 * 1000);
    if (rateLimited) return errorResponse(rateLimited, 429);

    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const phoneRaw = typeof body.phone === 'string' ? body.phone.trim() : '';

    if (!email) return errorResponse('E-mail é obrigatório', 400);
    if (!phoneRaw) return errorResponse('Telefone é obrigatório', 400);

    const phone = normalizePhone(phoneRaw);
    if (phone.length < 12) {
      return errorResponse('Telefone inválido. Use DDD + número com 9 (ex: 81999999999 ou 7999999999).', 400);
    }

    const { data: profile, error: profileError } = await supabaseServiceRole
      .from('profiles')
      .select('id')
      .eq('email', email)
      .single();

    if (profileError || !profile) {
      return successResponse(
        { sent: true },
        'Se o e-mail e telefone estiverem corretos, você receberá o código em instantes.'
      );
    }

    const evolution = await getLotoAssistenciaInstance();
    if (!evolution) {
      return errorResponse('Serviço de envio de código não configurado. Entre em contato com o administrador.', 503);
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);

    const { error: insertError } = await supabaseServiceRole
      .from('password_reset_codes')
      .insert({
        profile_id: profile.id,
        code,
        phone_sent_to: phone,
        expires_at: expiresAt.toISOString(),
      });

    if (insertError) {
      return errorResponse('Erro ao gerar código', 500);
    }

    const remoteJid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;

    let messageTemplate = 'Seu código de recuperação de senha Zaploto é: *{{Código}}*. Válido por 15 minutos. Não compartilhe.';
    const { data: msgRow } = await supabaseServiceRole
      .from('system_settings')
      .select('value')
      .eq('key', 'loto_assistencia_message')
      .maybeSingle();
    if (msgRow?.value && typeof msgRow.value === 'string') {
      messageTemplate = msgRow.value;
    }
    const text = messageTemplate.replace(/\{\{Código\}\}/g, code);

    try {
      await chatService.sendMessage(
        {
          instance_name: evolution.instance_name,
          apikey: evolution.apikey,
          base_url: evolution.base_url,
        },
        {
          remoteJid,
          type: 'text',
          text,
        }
      );
    } catch (sendErr: any) {
      console.error('[forgot-password/send-code] Erro ao enviar mensagem Evolution:', sendErr);
      return errorResponse('Falha ao enviar código por WhatsApp. Tente novamente ou contate o suporte.', 500);
    }

    return successResponse({ sent: true }, 'Código enviado para o número informado');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
