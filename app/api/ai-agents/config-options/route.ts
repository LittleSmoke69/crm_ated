import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/ai-agents/config-options
 * Retorna opções para configurar agente IA:
 * - Instâncias mestres do usuário (conectadas)
 * - Grupos do usuário
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    // Busca instâncias mestres conectadas do usuário
    const { data: masterInstances, error: instancesError } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, instance_name, phone_number, status')
      .eq('user_id', userId)
      .eq('is_master', true)
      .eq('is_active', true)
      .eq('status', 'ok')
      .order('created_at', { ascending: false });

    if (instancesError) {
      console.error('❌ [AI AGENTS CONFIG] Erro ao buscar instâncias:', instancesError);
    }

    // Busca grupos do usuário
    const { data: groups, error: groupsError } = await supabaseServiceRole
      .from('whatsapp_groups')
      .select('group_id, group_subject')
      .eq('user_id', userId)
      .order('group_subject', { ascending: true });

    if (groupsError) {
      console.error('❌ [AI AGENTS CONFIG] Erro ao buscar grupos:', groupsError);
    }

    return successResponse({
      instances: (masterInstances || []).map(inst => ({
        id: inst.id,
        name: inst.instance_name,
        phone: inst.phone_number,
      })),
      groups: (groups || []).map(g => ({
        jid: g.group_id,
        subject: g.group_subject,
      })),
    });
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar opções', 401);
  }
}

