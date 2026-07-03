/**
 * GET/PUT /api/admin/loto-assistencia
 * Gerencia a instância Evolution usada para envio de códigos (esqueci a senha).
 * Apenas admin e super_admin.
 */
import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { requireAuth } from '@/lib/middleware/auth';

const KEY_INSTANCE = 'loto_assistencia_instance_id';
const KEY_MESSAGE = 'loto_assistencia_message';
const KEY_MESSAGE_DISCONNECTED = 'loto_assistencia_message_instance_disconnected';
const KEY_MESSAGE_VERIFICATION_REPORT = 'loto_assistencia_message_verification_report';
const KEY_NOTIFY_USER_ID = 'loto_assistencia_notify_user_id';
const KEY_MESSAGE_TRANSFER_EXPIRED = 'loto_assistencia_message_transfer_expired';
const DEFAULT_MESSAGE = 'Seu código de recuperação de senha crm-atendimento é: *{{Código}}*. Válido por 15 minutos. Não compartilhe.';
const DEFAULT_MESSAGE_DISCONNECTED = '⚠️ *crm-atendimento*: A instância *{{NomeInstancia}}* foi desconectada. Status: {{Status}}. Acesse o painel para reconectar.';
const DEFAULT_MESSAGE_VERIFICATION_REPORT = '📋 *Relatório de instâncias Zaploto*\n\n{{Relatório}}\n\nVerifique o painel para mais detalhes.';
const DEFAULT_MESSAGE_TRANSFER_EXPIRED =
  '⏱️ *Zaploto – Prazo de transferência encerrado*\nBanca: {{Banca}}\nData da transferência: {{DataTransferencia}}\nOrigem: {{ConsultorOrigem}}\nDestino: {{ConsultorDestino}}\nLeads: {{QuantidadeLeads}}\n\nAcesse Admin → Transferência de Leads para resolver (vincular ou repassar).';

async function requireAdminOrSuperAdmin(userId: string) {
  const { data: profile } = await supabaseServiceRole
    .from('profiles')
    .select('status')
    .eq('id', userId)
    .single();
  const ok = profile?.status === 'super_admin' || profile?.status === 'admin';
  if (!ok) throw new Error('Acesso negado. Apenas admin e super_admin.');
}

/**
 * GET - Lista todas as instâncias mestres (evolution_instances com is_master = true) e retorna instância selecionada + mensagem personalizada.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    await requireAdminOrSuperAdmin(userId);

    const [
      instanceRes,
      messageRes,
      msgDisconnectedRes,
      msgReportRes,
      notifyUserRes,
      msgTransferExpiredRes,
      instancesRes,
      profilesRes,
    ] = await Promise.all([
      supabaseServiceRole.from('system_settings').select('value').eq('key', KEY_INSTANCE).maybeSingle(),
      supabaseServiceRole.from('system_settings').select('value').eq('key', KEY_MESSAGE).maybeSingle(),
      supabaseServiceRole.from('system_settings').select('value').eq('key', KEY_MESSAGE_DISCONNECTED).maybeSingle(),
      supabaseServiceRole.from('system_settings').select('value').eq('key', KEY_MESSAGE_VERIFICATION_REPORT).maybeSingle(),
      supabaseServiceRole.from('system_settings').select('value').eq('key', KEY_NOTIFY_USER_ID).maybeSingle(),
      supabaseServiceRole.from('system_settings').select('value').eq('key', KEY_MESSAGE_TRANSFER_EXPIRED).maybeSingle(),
      supabaseServiceRole
        .from('evolution_instances')
        .select(`
          id,
          instance_name,
          phone_number,
          evolution_apis ( id, name, base_url )
        `)
        .eq('is_master', true)
        .order('instance_name', { ascending: true }),
      supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email, telefone')
        .in('status', ['admin', 'super_admin'])
        .order('full_name', { ascending: true }),
    ]);

    const selectedId = instanceRes.data?.value ?? null;
    const messageTemplate = messageRes.data?.value ?? DEFAULT_MESSAGE;
    const message_instance_disconnected = msgDisconnectedRes.data?.value ?? DEFAULT_MESSAGE_DISCONNECTED;
    const message_verification_report = msgReportRes.data?.value ?? DEFAULT_MESSAGE_VERIFICATION_REPORT;
    const notify_user_id = (notifyUserRes.data?.value ?? '').trim() || null;
    const message_transfer_expired = msgTransferExpiredRes.data?.value ?? DEFAULT_MESSAGE_TRANSFER_EXPIRED;
    const { data: instances, error: instErr } = instancesRes;
    const { data: notifyProfiles } = profilesRes;

    if (instErr) {
      return errorResponse('Erro ao buscar instâncias mestres', 500);
    }

    return successResponse({
      instances: instances || [],
      selected_instance_id: selectedId,
      message_template: messageTemplate,
      message_instance_disconnected,
      message_verification_report,
      notify_user_id,
      message_transfer_expired,
      notify_profiles: (notifyProfiles || []).map((p: { id: string; full_name?: string | null; email?: string | null; telefone?: string | null }) => ({
        id: p.id,
        full_name: p.full_name ?? p.email ?? p.id,
        email: p.email ?? '',
        telefone: p.telefone ?? '',
      })),
    });
  } catch (err: any) {
    if (err.message === 'Acesso negado. Apenas admin e super_admin.') {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}

/**
 * PUT - Define instância e mensagens para Loto Assistência.
 * Body: { evolution_instance_id?: string | null, message_template?: string, message_instance_disconnected?: string, message_verification_report?: string }
 */
export async function PUT(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    await requireAdminOrSuperAdmin(userId);

    const body = await req.json().catch(() => ({}));
    const evolutionInstanceId = body.evolution_instance_id;
    const messageTemplate = body.message_template;
    const messageInstanceDisconnected = body.message_instance_disconnected;
    const messageVerificationReport = body.message_verification_report;
    const notifyUserId = body.notify_user_id;
    const messageTransferExpired = body.message_transfer_expired;

    if (evolutionInstanceId !== null && evolutionInstanceId !== undefined) {
      if (typeof evolutionInstanceId !== 'string' || !evolutionInstanceId.trim()) {
        return errorResponse('evolution_instance_id deve ser um UUID válido ou null', 400);
      }
      const { data: inst } = await supabaseServiceRole
        .from('evolution_instances')
        .select('id')
        .eq('id', evolutionInstanceId.trim())
        .maybeSingle();
      if (!inst) {
        return errorResponse('Instância não encontrada', 404);
      }
    }

    const instanceValue = evolutionInstanceId === null || evolutionInstanceId === undefined
      ? null
      : String(evolutionInstanceId).trim();

    const now = new Date().toISOString();

    const updates: { key: string; value: string | null; updated_at: string }[] = [
      { key: KEY_INSTANCE, value: instanceValue, updated_at: now },
    ];
    if (typeof messageTemplate === 'string') {
      updates.push({
        key: KEY_MESSAGE,
        value: messageTemplate.trim() || DEFAULT_MESSAGE,
        updated_at: now,
      });
    }
    if (typeof messageInstanceDisconnected === 'string') {
      updates.push({
        key: KEY_MESSAGE_DISCONNECTED,
        value: messageInstanceDisconnected.trim() || DEFAULT_MESSAGE_DISCONNECTED,
        updated_at: now,
      });
    }
    if (typeof messageVerificationReport === 'string') {
      updates.push({
        key: KEY_MESSAGE_VERIFICATION_REPORT,
        value: messageVerificationReport.trim() || DEFAULT_MESSAGE_VERIFICATION_REPORT,
        updated_at: now,
      });
    }
    if (notifyUserId !== undefined && notifyUserId !== null) {
      const v = typeof notifyUserId === 'string' ? notifyUserId.trim() : '';
      updates.push({ key: KEY_NOTIFY_USER_ID, value: v || '', updated_at: now });
    }
    if (typeof messageTransferExpired === 'string') {
      updates.push({
        key: KEY_MESSAGE_TRANSFER_EXPIRED,
        value: messageTransferExpired.trim() || DEFAULT_MESSAGE_TRANSFER_EXPIRED,
        updated_at: now,
      });
    }

    for (const row of updates) {
      const { error: upsertErr } = await supabaseServiceRole
        .from('system_settings')
        .upsert(row, { onConflict: 'key' });
      if (upsertErr) {
        return errorResponse('Erro ao salvar configuração', 500);
      }
    }

    return successResponse(
      {
        loto_assistencia_instance_id: instanceValue,
        message_template: typeof messageTemplate === 'string' ? messageTemplate.trim() || DEFAULT_MESSAGE : undefined,
        message_instance_disconnected: typeof messageInstanceDisconnected === 'string' ? messageInstanceDisconnected.trim() || DEFAULT_MESSAGE_DISCONNECTED : undefined,
        message_verification_report: typeof messageVerificationReport === 'string' ? messageVerificationReport.trim() || DEFAULT_MESSAGE_VERIFICATION_REPORT : undefined,
        notify_user_id: notifyUserId !== undefined && notifyUserId !== null ? (typeof notifyUserId === 'string' ? notifyUserId.trim() : '') : undefined,
        message_transfer_expired: typeof messageTransferExpired === 'string' ? messageTransferExpired.trim() || DEFAULT_MESSAGE_TRANSFER_EXPIRED : undefined,
      },
      'Configuração salva'
    );
  } catch (err: any) {
    if (err.message === 'Acesso negado. Apenas admin e super_admin.') {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
