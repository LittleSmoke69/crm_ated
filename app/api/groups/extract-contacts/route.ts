import { NextRequest } from 'next/server';
import { requireAuthWithProfile } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { checkInstanceAccess } from '@/lib/utils/instance-access';
import { getGroupParticipantsV2 } from '@/lib/anti-spam/evolution-client';

/**
 * POST /api/groups/extract-contacts — participantes via Evolution API V2
 * GET /group/participants/{instance}?groupJid=...
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireAuthWithProfile(req);
    if (profile.status !== 'admin' && profile.status !== 'super_admin') {
      return errorResponse('Acesso negado. Apenas admin ou super_admin podem extrair contatos.', 403);
    }

    const body = await req.json();
    const { instanceName, groupId } = body;

    if (!instanceName || !groupId) {
      return errorResponse('instanceName e groupId são obrigatórios', 400);
    }

    const hasAccess = await checkInstanceAccess(req, userId, instanceName);
    if (!hasAccess) {
      return errorResponse('Acesso negado. Você não tem permissão para acessar esta instância.', 403);
    }

    const { data: instance, error: instanceError } = await supabaseServiceRole
      .from('evolution_instances')
      .select(`
        id,
        apikey,
        evolution_apis!inner (
          id,
          base_url,
          is_active
        )
      `)
      .eq('instance_name', instanceName)
      .eq('is_active', true)
      .eq('evolution_apis.is_active', true)
      .single();

    if (instanceError || !instance) {
      return errorResponse('Instância não encontrada', 404);
    }

    if (!instance.apikey) {
      return errorResponse('Instância sem apikey configurada', 404);
    }

    const evolutionApi = Array.isArray(instance.evolution_apis)
      ? instance.evolution_apis[0]
      : instance.evolution_apis;

    if (!evolutionApi?.base_url) {
      return errorResponse('Evolution API sem base_url configurada', 404);
    }

    const gp = await getGroupParticipantsV2(instance.id, String(groupId).trim());
    if (!gp.success || !gp.participants) {
      return errorResponse(gp.error || 'Erro ao buscar participantes do grupo', gp.httpStatus ?? 502);
    }

    const normalizePhoneNumber = (phone: string): string => {
      let cleaned = phone.replace(/\D/g, '');
      if (cleaned.startsWith('5555')) {
        cleaned = cleaned.substring(2);
      }
      if (cleaned.startsWith('55') && !cleaned.startsWith('5555')) {
        return cleaned;
      }
      return `55${cleaned}`;
    };

    const formattedContacts = gp.participants
      .map((p) => {
        const telefone = normalizePhoneNumber(p.phone);
        return {
          id: p.phone,
          name: p.name ?? '',
          telefone,
          admin: p.admin ?? null,
        };
      })
      .filter((c) => c.telefone.length > 0);

    return successResponse(
      formattedContacts,
      `${formattedContacts.length} contato(s) extraído(s) do grupo`
    );
  } catch (err: unknown) {
    return serverErrorResponse(err);
  }
}

