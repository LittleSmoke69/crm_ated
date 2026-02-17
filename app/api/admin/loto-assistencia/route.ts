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
const DEFAULT_MESSAGE = 'Seu código de recuperação de senha Zaploto é: *{{Código}}*. Válido por 15 minutos. Não compartilhe.';

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

    const [instanceRes, messageRes, instancesRes] = await Promise.all([
      supabaseServiceRole.from('system_settings').select('value').eq('key', KEY_INSTANCE).maybeSingle(),
      supabaseServiceRole.from('system_settings').select('value').eq('key', KEY_MESSAGE).maybeSingle(),
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
    ]);

    const selectedId = instanceRes.data?.value ?? null;
    const messageTemplate = messageRes.data?.value ?? DEFAULT_MESSAGE;
    const { data: instances, error: instErr } = instancesRes;

    if (instErr) {
      return errorResponse('Erro ao buscar instâncias mestres', 500);
    }

    return successResponse({
      instances: instances || [],
      selected_instance_id: selectedId,
      message_template: messageTemplate,
    });
  } catch (err: any) {
    if (err.message === 'Acesso negado. Apenas admin e super_admin.') {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}

/**
 * PUT - Define instância e mensagem para Loto Assistência.
 * Body: { evolution_instance_id?: string | null, message_template?: string }
 */
export async function PUT(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    await requireAdminOrSuperAdmin(userId);

    const body = await req.json().catch(() => ({}));
    const evolutionInstanceId = body.evolution_instance_id;
    const messageTemplate = body.message_template;

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

    for (const row of updates) {
      const { error: upsertErr } = await supabaseServiceRole
        .from('system_settings')
        .upsert(row, { onConflict: 'key' });
      if (upsertErr) {
        return errorResponse('Erro ao salvar configuração', 500);
      }
    }

    return successResponse(
      { loto_assistencia_instance_id: instanceValue, message_template: typeof messageTemplate === 'string' ? messageTemplate.trim() || DEFAULT_MESSAGE : undefined },
      'Configuração salva'
    );
  } catch (err: any) {
    if (err.message === 'Acesso negado. Apenas admin e super_admin.') {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
