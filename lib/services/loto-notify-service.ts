/**
 * Serviço de notificações via Loto Assistente (instância Evolution configurada no admin).
 * Usado para: aviso de instância desconectada e relatório de verificação de instâncias.
 * Falhas no envio são apenas registradas em log e não interferem no fluxo principal.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { chatService } from '@/lib/services/chat-service';

const KEY_INSTANCE = 'loto_assistencia_instance_id';
const KEY_MESSAGE_DISCONNECTED = 'loto_assistencia_message_instance_disconnected';
const KEY_MESSAGE_VERIFICATION_REPORT = 'loto_assistencia_message_verification_report';
const KEY_NOTIFY_USER_ID = 'loto_assistencia_notify_user_id';
const KEY_MESSAGE_TRANSFER_EXPIRED = 'loto_assistencia_message_transfer_expired';

const DEFAULT_MESSAGE_DISCONNECTED =
  '⚠️ *Zaploto*: A instância *{{NomeInstancia}}* foi desconectada. Status: {{Status}}. Acesse o painel para reconectar.';
const DEFAULT_MESSAGE_VERIFICATION_REPORT =
  '📋 *Relatório de instâncias Zaploto*\n\n{{Relatório}}\n\nVerifique o painel para mais detalhes.';

export interface LotoConfig {
  instance_name: string;
  apikey: string;
  base_url: string;
}

async function getLotoConfig(): Promise<LotoConfig | null> {
  const { data: row } = await supabaseServiceRole
    .from('system_settings')
    .select('value')
    .eq('key', KEY_INSTANCE)
    .maybeSingle();

  const instanceId = row?.value;
  if (!instanceId) return null;

  const { data: instance, error } = await supabaseServiceRole
    .from('evolution_instances')
    .select(`
      id,
      instance_name,
      apikey,
      evolution_apis ( base_url, api_key_global )
    `)
    .eq('id', instanceId)
    .single();

  if (error || !instance) return null;
  const apis = instance.evolution_apis as any;
  const baseUrl = Array.isArray(apis) ? apis[0]?.base_url : apis?.base_url;
  const apikey = instance.apikey || (Array.isArray(apis) ? apis[0]?.api_key_global : apis?.api_key_global);
  if (!baseUrl || !apikey) return null;

  return {
    instance_name: instance.instance_name,
    apikey,
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

/**
 * Envia aviso de instância desconectada para o telefone do perfil do dono da instância.
 * Se falhar, apenas registra em log (não propaga erro).
 */
export async function notifyInstanceDisconnected(params: {
  instanceName: string;
  instanceId: string;
  userId: string;
  previousStatus: string;
  newStatus: string;
}): Promise<void> {
  const { instanceName, userId } = params;
  try {
    const config = await getLotoConfig();
    if (!config) {
      console.warn('[loto-notify] Loto Assistente não configurado. Não enviando aviso de desconexão.');
      return;
    }

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('telefone')
      .eq('id', userId)
      .single();

    const phone = profile?.telefone?.trim();
    if (!phone || phone.length < 10) {
      console.warn(`[loto-notify] Usuário ${userId} (instância ${instanceName}) sem telefone no perfil. Não enviando aviso.`);
      return;
    }

    let template = DEFAULT_MESSAGE_DISCONNECTED;
    const { data: msgRow } = await supabaseServiceRole
      .from('system_settings')
      .select('value')
      .eq('key', KEY_MESSAGE_DISCONNECTED)
      .maybeSingle();
    if (msgRow?.value && typeof msgRow.value === 'string') {
      template = msgRow.value;
    }

    const text = template
      .replace(/\{\{NomeInstancia\}\}/g, instanceName)
      .replace(/\{\{Status\}\}/g, params.newStatus || 'desconectada');

    const remoteJid = phone.includes('@') ? phone : `${normalizePhone(phone)}@s.whatsapp.net`;
    await chatService.sendMessage(
      {
        instance_name: config.instance_name,
        apikey: config.apikey,
        base_url: config.base_url,
      },
      { remoteJid, type: 'text', text }
    );
    console.log(`[loto-notify] Aviso de desconexão enviado para ${phone} (instância ${instanceName})`);
  } catch (err: any) {
    console.error(`[loto-notify] Falha ao enviar aviso de desconexão (instância ${instanceName}):`, err?.message || err);
    // Não propaga: apenas registro
  }
}

/**
 * Envia relatório de verificação de instâncias para o telefone do perfil do usuário.
 * Se falhar, apenas registra em log.
 */
export async function sendVerificationReport(params: {
  userId: string;
  reportLines: string[];
}): Promise<void> {
  const { userId, reportLines } = params;
  try {
    const config = await getLotoConfig();
    if (!config) {
      console.warn('[loto-notify] Loto Assistente não configurado. Relatório de verificação não enviado.');
      return;
    }

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('telefone')
      .eq('id', userId)
      .single();

    const phone = profile?.telefone?.trim();
    if (!phone || phone.length < 10) {
      console.warn(`[loto-notify] Usuário ${userId} sem telefone no perfil. Relatório de verificação não enviado.`);
      return;
    }

    let template = DEFAULT_MESSAGE_VERIFICATION_REPORT;
    const { data: msgRow } = await supabaseServiceRole
      .from('system_settings')
      .select('value')
      .eq('key', KEY_MESSAGE_VERIFICATION_REPORT)
      .maybeSingle();
    if (msgRow?.value && typeof msgRow.value === 'string') {
      template = msgRow.value;
    }

    const reportBlock = reportLines.join('\n');
    const text = template.replace(/\{\{Relatório\}\}/g, reportBlock);

    const remoteJid = phone.includes('@') ? phone : `${normalizePhone(phone)}@s.whatsapp.net`;
    await chatService.sendMessage(
      {
        instance_name: config.instance_name,
        apikey: config.apikey,
        base_url: config.base_url,
      },
      { remoteJid, type: 'text', text }
    );
    console.log(`[loto-notify] Relatório de verificação enviado para ${phone}`);
  } catch (err: any) {
    console.error('[loto-notify] Falha ao enviar relatório de verificação:', err?.message || err);
  }
}

const DEFAULT_MESSAGE_TRANSFER_EXPIRED =
  '⏱️ *Zaploto – Prazo de transferência encerrado*\nBanca: {{Banca}}\nData da transferência: {{DataTransferencia}}\nOrigem: {{ConsultorOrigem}}\nDestino: {{ConsultorDestino}}\nLeads: {{QuantidadeLeads}}\n\nAcesse Admin → Transferência de Leads para resolver (vincular ou repassar).';

/**
 * Envia notificação de prazo de transferência expirado para o perfil configurado em Loto Assistência.
 * Usa o telefone do perfil definido em loto_assistencia_notify_user_id.
 */
export async function notifyTransferExpired(params: {
  bancaName: string;
  createdAt: string;
  sourceConsultantEmail: string;
  targetConsultantEmail: string;
  count: number;
}): Promise<void> {
  try {
    const config = await getLotoConfig();
    if (!config) {
      console.warn('[loto-notify] Loto Assistente não configurado. Notificação de transferência expirada não enviada.');
      return;
    }

    const { data: notifyUserRow } = await supabaseServiceRole
      .from('system_settings')
      .select('value')
      .eq('key', KEY_NOTIFY_USER_ID)
      .maybeSingle();

    const notifyUserId = (notifyUserRow?.value as string)?.trim();
    if (!notifyUserId) {
      console.warn('[loto-notify] Perfil de notificação de transferência não configurado (loto_assistencia_notify_user_id).');
      return;
    }

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('telefone')
      .eq('id', notifyUserId)
      .single();

    const phone = profile?.telefone?.trim();
    if (!phone || phone.length < 10) {
      console.warn(`[loto-notify] Perfil ${notifyUserId} sem telefone. Notificação de transferência expirada não enviada.`);
      return;
    }

    let template = DEFAULT_MESSAGE_TRANSFER_EXPIRED;
    const { data: msgRow } = await supabaseServiceRole
      .from('system_settings')
      .select('value')
      .eq('key', KEY_MESSAGE_TRANSFER_EXPIRED)
      .maybeSingle();
    if (msgRow?.value && typeof msgRow.value === 'string') {
      template = msgRow.value;
    }

    const formatDate = (iso: string) => {
      try {
        const d = new Date(iso);
        return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      } catch {
        return iso;
      }
    };

    const text = template
      .replace(/\{\{Banca\}\}/g, params.bancaName || '-')
      .replace(/\{\{DataTransferencia\}\}/g, formatDate(params.createdAt))
      .replace(/\{\{ConsultorOrigem\}\}/g, params.sourceConsultantEmail || '-')
      .replace(/\{\{ConsultorDestino\}\}/g, params.targetConsultantEmail || '-')
      .replace(/\{\{QuantidadeLeads\}\}/g, String(params.count ?? 0));

    const remoteJid = phone.includes('@') ? phone : `${normalizePhone(phone)}@s.whatsapp.net`;
    await chatService.sendMessage(
      {
        instance_name: config.instance_name,
        apikey: config.apikey,
        base_url: config.base_url,
      },
      { remoteJid, type: 'text', text }
    );
    console.log(`[loto-notify] Notificação de transferência expirada enviada para ${phone} (banca: ${params.bancaName})`);
  } catch (err: any) {
    console.error('[loto-notify] Falha ao enviar notificação de transferência expirada:', err?.message || err);
  }
}
