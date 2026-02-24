/**
 * Netlify Scheduled Function: transfer-expired-notify
 *
 * Roda diariamente (ex.: 0 8 * * * = 8h). Busca transferências de leads cujo prazo de 10 dias
 * expirou e ainda não foram notificadas; envia mensagem via Loto Assistente para o perfil
 * configurado em loto_assistencia_notify_user_id (telefone do perfil).
 */

import { createClient } from '@supabase/supabase-js';

const DAYS_DEADLINE = 10;
const KEY_INSTANCE = 'loto_assistencia_instance_id';
const KEY_NOTIFY_USER_ID = 'loto_assistencia_notify_user_id';
const KEY_MESSAGE_TRANSFER_EXPIRED = 'loto_assistencia_message_transfer_expired';
const DEFAULT_MESSAGE =
  '⏱️ *Zaploto – Prazo de transferência encerrado*\nBanca: {{Banca}}\nData da transferência: {{DataTransferencia}}\nOrigem: {{ConsultorOrigem}}\nDestino: {{ConsultorDestino}}\nLeads: {{QuantidadeLeads}}\n\nAcesse Admin → Transferência de Leads para resolver (vincular ou repassar).';

function normalizePhone(input: string): string {
  let num = input.replace(/\D/g, '');
  if (num.length >= 10 && num.length <= 11 && !num.startsWith('55')) num = '55' + num;
  return num;
}

function formatDatePt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export const handler = async () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('[transfer-expired-notify] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes');
    return { statusCode: 500, body: JSON.stringify({ error: 'Configuração ausente' }) };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } });

  try {
    const deadline = new Date();
    deadline.setDate(deadline.getDate() - DAYS_DEADLINE);
    const deadlineIso = deadline.toISOString();

    const { data: logs, error: logsErr } = await supabase
      .from('admin_lead_transfer_logs')
      .select('id, banca_id, created_at, source_consultant_email, target_consultant_email, count')
      .is('transfer_expired_notified_at', null)
      .lt('created_at', deadlineIso)
      .order('created_at', { ascending: true });

    if (logsErr) {
      console.error('[transfer-expired-notify] Erro ao buscar logs:', logsErr);
      return { statusCode: 500, body: JSON.stringify({ error: logsErr.message }) };
    }

    if (!logs?.length) {
      console.log('[transfer-expired-notify] Nenhuma transferência com prazo expirado pendente.');
      return { statusCode: 200, body: JSON.stringify({ notified: 0, message: 'Nenhuma pendente' }) };
    }

    const { data: notifyUserRow } = await supabase.from('system_settings').select('value').eq('key', KEY_NOTIFY_USER_ID).maybeSingle();
    const notifyUserId = (notifyUserRow?.value as string)?.trim();
    if (!notifyUserId) {
      console.warn('[transfer-expired-notify] loto_assistencia_notify_user_id não configurado. Nenhuma notificação enviada.');
      return { statusCode: 200, body: JSON.stringify({ notified: 0, message: 'Perfil de notificação não configurado' }) };
    }

    const { data: profile } = await supabase.from('profiles').select('telefone').eq('id', notifyUserId).single();
    const phone = profile?.telefone?.trim();
    if (!phone || phone.length < 10) {
      console.warn('[transfer-expired-notify] Perfil sem telefone. Nenhuma notificação enviada.');
      return { statusCode: 200, body: JSON.stringify({ notified: 0, message: 'Perfil sem telefone' }) };
    }

    const { data: instanceRow } = await supabase.from('system_settings').select('value').eq('key', KEY_INSTANCE).maybeSingle();
    const instanceId = instanceRow?.value;
    if (!instanceId) {
      console.warn('[transfer-expired-notify] Loto Assistente (instância) não configurado.');
      return { statusCode: 200, body: JSON.stringify({ notified: 0, message: 'Loto não configurado' }) };
    }

    const { data: evoInstance, error: evoErr } = await supabase
      .from('evolution_instances')
      .select('instance_name, apikey, evolution_apis ( base_url, api_key_global )')
      .eq('id', instanceId)
      .single();

    if (evoErr || !evoInstance) {
      console.warn('[transfer-expired-notify] Instância Loto não encontrada.');
      return { statusCode: 200, body: JSON.stringify({ notified: 0, message: 'Instância não encontrada' }) };
    }

    const apis = (evoInstance as any).evolution_apis;
    const baseUrl = Array.isArray(apis) ? apis[0]?.base_url : apis?.base_url;
    const apikey = (evoInstance as any).apikey || (Array.isArray(apis) ? apis[0]?.api_key_global : apis?.api_key_global);
    if (!baseUrl?.trim() || !apikey) {
      console.warn('[transfer-expired-notify] Instância sem base_url ou apikey.');
      return { statusCode: 200, body: JSON.stringify({ notified: 0, message: 'Instância incompleta' }) };
    }

    let template = DEFAULT_MESSAGE;
    const { data: msgRow } = await supabase.from('system_settings').select('value').eq('key', KEY_MESSAGE_TRANSFER_EXPIRED).maybeSingle();
    if (msgRow?.value && typeof msgRow.value === 'string') template = msgRow.value;

    const bancaIds = [...new Set((logs as { banca_id: string }[]).map((l) => l.banca_id))];
    const { data: bancas } = await supabase.from('crm_bancas').select('id, name').in('id', bancaIds);
    const bancaNameById: Record<string, string> = {};
    (bancas || []).forEach((b: { id: string; name?: string }) => {
      bancaNameById[b.id] = b.name || b.id;
    });

    const instanceName = (evoInstance as any).instance_name;
    const sendUrl = `${String(baseUrl).replace(/\/+$/, '')}/message/sendText/${instanceName}`;
    const remoteJid = phone.includes('@') ? phone : `${normalizePhone(phone)}@s.whatsapp.net`;
    let notified = 0;

    for (const log of logs as { id: string; banca_id: string; created_at: string; source_consultant_email: string; target_consultant_email: string; count: number }[]) {
      const bancaName = bancaNameById[log.banca_id] || log.banca_id;
      const text = template
        .replace(/\{\{Banca\}\}/g, bancaName)
        .replace(/\{\{DataTransferencia\}\}/g, formatDatePt(log.created_at))
        .replace(/\{\{ConsultorOrigem\}\}/g, log.source_consultant_email || '-')
        .replace(/\{\{ConsultorDestino\}\}/g, log.target_consultant_email || '-')
        .replace(/\{\{QuantidadeLeads\}\}/g, String(log.count ?? 0));

      try {
        const res = await fetch(sendUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey },
          body: JSON.stringify({ number: remoteJid, text }),
        });
        if (res.ok) {
          await supabase.from('admin_lead_transfer_logs').update({ transfer_expired_notified_at: new Date().toISOString() }).eq('id', log.id);
          notified++;
          console.log(`[transfer-expired-notify] Notificação enviada para log ${log.id} (${bancaName})`);
        } else {
          console.warn(`[transfer-expired-notify] Falha HTTP ${res.status} ao enviar para log ${log.id}`);
        }
      } catch (e: any) {
        console.error(`[transfer-expired-notify] Erro ao enviar para log ${log.id}:`, e?.message || e);
      }
    }

    return { statusCode: 200, body: JSON.stringify({ notified, total: logs.length }) };
  } catch (err: any) {
    console.error('[transfer-expired-notify] Erro:', err?.message || err);
    return { statusCode: 500, body: JSON.stringify({ error: err?.message || 'Erro interno' }) };
  }
};
