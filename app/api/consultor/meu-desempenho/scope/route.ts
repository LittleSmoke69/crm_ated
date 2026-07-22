import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import {
  getDashboardScopeForUser,
  getVisibleBancasAndDescendantIds,
} from '@/lib/services/dashboard/consultor-bets-deposits';

/**
 * GET /api/consultor/meu-desempenho/scope?banca_url=<opcional>
 *
 * Retorna o escopo hierárquico de "Meu Desempenho" para o usuário logado:
 *  - bancas visíveis (lista)
 *  - defaultBancaUrl (primeira banca visível)
 *  - userStatus (papel do usuário)
 *  - consultantProfiles (se banca_url foi informada): perfis agregados para os cards/CSV
 *  - scopeLabel: descrição curta para UI
 *
 * Regras de papel:
 *  - consultor          → só ele
 *  - gerente            → ele + consultores subordinados
 *  - gestor             → igual ao dono na banca (gerentes + consultores da hierarquia do dono)
 *  - dono_banca         → gerentes + consultores subordinados (sem ele mesmo)
 *  - admin/super_admin  → todos os perfis (consultor/gerente/gestor/admin) da banca
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const visibilityBundle = await getVisibleBancasAndDescendantIds(userId);
    const profile = visibilityBundle.profile;
    if (!profile) {
      return errorResponse('Perfil não encontrado.', 404);
    }

    const allowedStatuses = new Set([
      'super_admin',
      'admin',
      'gerente',
      'captador',
    ]);
    if (!profile.status || !allowedStatuses.has(String(profile.status).trim().toLowerCase())) {
      return errorResponse('Acesso negado.', 403);
    }

    const { searchParams } = req.nextUrl;
    const bancaUrl = searchParams.get('banca_url')?.trim() || null;

    // Sem banca: devolve apenas lista visível e default (reutiliza bundle já carregado)
    if (!bancaUrl) {
      const bancas = visibilityBundle.visibleBancas;
      return successResponse({
        allowed: true,
        userStatus: profile.status,
        bancas,
        defaultBancaUrl: bancas[0]?.url ?? null,
        consultantProfiles: [],
        scopeLabel:
          bancas.length === 0
            ? 'Nenhuma banca vinculada ao seu usuário'
            : 'Selecione uma banca',
      });
    }

    const scope = await getDashboardScopeForUser({ userId, bancaUrl, visibilityBundle });
    if (!scope.allowed) {
      return errorResponse(
        scope.reason === 'banca_out_of_scope'
          ? 'Esta banca está fora do seu escopo.'
          : 'Escopo indisponível.',
        403
      );
    }

    return successResponse(scope);
  } catch (err: any) {
    console.error('[MeuDesempenho/Scope] Erro:', err?.message);
    if (err?.message?.includes('Acesso negado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
