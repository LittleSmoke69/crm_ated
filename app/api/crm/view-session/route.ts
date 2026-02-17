import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { canAccessUser, getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/** Sessões com heartbeat > HEARTBEAT_TTL_MS são consideradas inativas */
const HEARTBEAT_TTL_MS = 2 * 60 * 1000; // 2 minutos

/**
 * GET /api/crm/view-session?consultant_id=xxx
 * Retorna quem está visualizando o CRM do consultor (para o consultor ver).
 * Apenas consultores podem chamar para o próprio consultant_id.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = req.nextUrl;
    const consultantId = searchParams.get('consultant_id') || userId;

    const profile = await getUserProfile(userId);
    if (!profile) {
      return errorResponse('Perfil não encontrado.', 401);
    }

    // Apenas o próprio consultor pode ver quem está visualizando seu CRM
    if (consultantId !== userId) {
      return errorResponse('Acesso negado. Você só pode ver quem está visualizando seu próprio CRM.', 403);
    }

    const cutoff = new Date(Date.now() - HEARTBEAT_TTL_MS).toISOString();

    const { data: sessions, error } = await supabaseServiceRole
      .from('crm_view_sessions')
      .select('viewer_id, viewer_name, last_heartbeat')
      .eq('consultant_id', consultantId)
      .gt('last_heartbeat', cutoff)
      .order('last_heartbeat', { ascending: false });

    if (error) {
      console.error('[CRM View Session] Erro ao buscar sessões:', error);
      return errorResponse('Erro ao buscar sessões de visualização.', 500);
    }

    const viewers = (sessions || []).map((s) => ({
      id: s.viewer_id,
      name: s.viewer_name || 'Supervisor',
    }));

    return successResponse({ viewers });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao buscar sessões';
    return errorResponse(message, 401);
  }
}

/**
 * POST /api/crm/view-session
 * Body: { consultantId: string }
 * Registra ou atualiza o heartbeat de que o gerente/dono está visualizando o CRM do consultor.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const resolvedProfile = await getUserProfile(userId);

    if (!resolvedProfile) {
      return errorResponse('Perfil não encontrado.', 401);
    }

    let body: { consultantId?: string };
    try {
      body = await req.json();
    } catch {
      return errorResponse('Body inválido. Esperado: { consultantId: string }', 400);
    }

    const consultantId = body?.consultantId;
    if (!consultantId || typeof consultantId !== 'string') {
      return errorResponse('consultantId é obrigatório.', 400);
    }

    // Só gerente, dono_banca ou admin podem visualizar CRM de outros
    const allowedStatuses = ['gerente', 'dono_banca', 'admin', 'super_admin'];
    if (!allowedStatuses.includes(resolvedProfile.status || '')) {
      return errorResponse('Apenas gerentes e supervisores podem registrar visualização de CRM.', 403);
    }

    // Não precisa registrar se estiver vendo o próprio CRM
    if (consultantId === userId) {
      return successResponse({ registered: false });
    }

    const hasAccess = await canAccessUser(userId, consultantId);
    if (!hasAccess) {
      return errorResponse('Você não tem permissão para acessar o CRM deste consultor.', 403);
    }

    const viewerName = resolvedProfile.full_name || resolvedProfile.email || 'Supervisor';

    const { error } = await supabaseServiceRole
      .from('crm_view_sessions')
      .upsert(
        {
          consultant_id: consultantId,
          viewer_id: userId,
          viewer_name: viewerName,
          last_heartbeat: new Date().toISOString(),
        },
        {
          onConflict: 'consultant_id,viewer_id',
          ignoreDuplicates: false,
        }
      );

    if (error) {
      console.error('[CRM View Session] Erro ao registrar sessão:', error);
      return errorResponse('Erro ao registrar visualização.', 500);
    }

    return successResponse({ registered: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao registrar visualização';
    return errorResponse(message, 401);
  }
}

/**
 * DELETE /api/crm/view-session?consultant_id=xxx
 * Remove o registro de que o gerente está visualizando o CRM (ao sair da página).
 */
export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = req.nextUrl;
    const consultantId = searchParams.get('consultant_id');

    if (!consultantId) {
      return errorResponse('consultant_id é obrigatório na query.', 400);
    }

    const { error } = await supabaseServiceRole
      .from('crm_view_sessions')
      .delete()
      .eq('consultant_id', consultantId)
      .eq('viewer_id', userId);

    if (error) {
      console.error('[CRM View Session] Erro ao remover sessão:', error);
      return errorResponse('Erro ao remover visualização.', 500);
    }

    return successResponse({ removed: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao remover visualização';
    return errorResponse(message, 401);
  }
}
