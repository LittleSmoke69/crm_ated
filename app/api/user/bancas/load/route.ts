import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { saveUserBancas } from '@/lib/utils/user-bancas';
import { getBancasVisiveis } from '@/app/api/crm/bancas/route';

/** Perfis que têm busca de bancas por email nas APIs externas (consultor/gerente). */
const ROLES_COM_BUSCA_POR_EMAIL = ['consultor', 'gerente'] as const;

/**
 * POST /api/user/bancas/load
 * Carrega e renova as bancas em que o usuário trabalha, usando o email para
 * pesquisar em cada banca (APIs get-indicateds-by-consultant / user-consultant-info).
 * Persiste o resultado em user_bancas; o gerente passa a figurar na hierarquia da banca
 * pelo vínculo em user_bancas (enroller não é obrigatório).
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const profile = await getUserProfile(userId);

    if (!profile) {
      return errorResponse('Perfil não encontrado.', 404);
    }

    const status = profile.status ?? '';
    if (!ROLES_COM_BUSCA_POR_EMAIL.includes(status as any)) {
      return errorResponse(
        'Carregar bancas por email está disponível apenas para consultores e gerentes.',
        403
      );
    }

    const email = profile.email?.trim() ?? '';
    console.log('[Perfil] Página /perfil — botão "Carregar bancas" clicado: iniciando busca em TODAS as bancas | userId:', userId, '| perfil:', status, '| email:', email ? `${email.slice(0, 3)}***` : 'n/a');
    const bancas = await getBancasVisiveis(userId, profile, { forceSearchAllBancas: true });
    const bancaIds = bancas.map((b) => b.id);
    console.log('[Perfil] Página /perfil — Carregar bancas: resultado', bancas.length, 'banca(s) | ids:', bancaIds.join(', ') || '(nenhuma)');

    await saveUserBancas(userId, bancaIds);

    return successResponse({
      success: true,
      bancas: bancas.map((b) => ({ id: b.id, name: b.name, url: b.url })),
      count: bancas.length,
    });
  } catch (err: unknown) {
    console.error('[POST /api/user/bancas/load] Erro:', err);
    return serverErrorResponse(err);
  }
}
