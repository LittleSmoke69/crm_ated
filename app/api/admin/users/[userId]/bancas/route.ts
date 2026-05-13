import { NextRequest } from 'next/server';
import { requireAdminOrSuporte } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';
import { recordHierarchyNetworkAudit } from '@/lib/admin/hierarchy-network-audit';

const LOG = '[PUT /api/admin/users/[userId]/bancas]';

/** Status para os quais o GET retorna banca_ids (demais retornam []). Inclui admin para vínculo na hierarquia. PUT aceita qualquer usuário. */
const STATUS_WITH_BANCAS = ['consultor', 'gerente', 'gestor', 'suporte', 'admin', 'super_admin'];

/**
 * PUT /api/admin/users/[userId]/bancas - Define as bancas em que o consultor/gerente atua (admin)
 * Body: { banca_ids: string[] } - IDs da tabela crm_bancas (apenas do tenant atual)
 * Aceita qualquer usuário (hierarquia pode atribuir banca ao mudar cargo para gerente/consultor).
 * IDs que não existem em crm_bancas ou são de outro tenant são omitidos (sucesso parcial).
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { profile } = await requireAdminOrSuporte(req);
    const zaplotoId = await getEffectiveZaplotoId(req, profile);
    const { userId } = await params;

    const { data: userProfile } = await supabaseServiceRole
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .single();

    if (!userProfile) {
      console.warn(`${LOG} Usuário não encontrado: ${userId}`);
      return errorResponse('Usuário não encontrado', 404);
    }

    const { data: prevBancasRow } = await supabaseServiceRole
      .from('user_bancas')
      .select('banca_ids')
      .eq('user_id', userId)
      .maybeSingle();
    const prevIds = Array.isArray(prevBancasRow?.banca_ids) ? [...(prevBancasRow!.banca_ids as string[])] : [];

    const { data: targetProfile } = await supabaseServiceRole
      .from('profiles')
      .select('email, status')
      .eq('id', userId)
      .maybeSingle();

    const body = await req.json().catch(() => ({}));
    const rawBancaIds = body?.banca_ids;

    if (!Array.isArray(rawBancaIds)) {
      console.warn(`${LOG} banca_ids não é array. userId=${userId} body keys=${Object.keys(body || {}).join(',')} type=${typeof rawBancaIds}`);
      return errorResponse('banca_ids deve ser um array de IDs (UUID)', 400);
    }

    const bancaIds = rawBancaIds
      .map((id: unknown) => String(id).trim().toLowerCase())
      .filter((id) => id && id !== 'undefined');

    let idsToSave = bancaIds;
    let omittedMessage: string | undefined;

    if (bancaIds.length > 0) {
      const { data: existing, error: checkError } = await supabaseServiceRole
        .from('crm_bancas')
        .select('id')
        .in('id', bancaIds)
        .or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`);

      if (checkError) {
        console.error(`${LOG} Erro ao buscar crm_bancas:`, checkError);
        return errorResponse('Erro ao validar bancas', 500);
      }
      const validIds = (existing || []).map((b: { id: string }) => String(b.id).toLowerCase());
      const invalid = bancaIds.filter((id) => !validIds.includes(id));
      if (invalid.length > 0) {
        console.warn(`${LOG} IDs omitidos (não encontrados ou outro tenant). userId=${userId} inválidos=${invalid.join(',')}`);
        idsToSave = validIds;
        omittedMessage =
          invalid.length === 1
            ? '1 ID não encontrado em crm_bancas (ou de outro tenant) foi omitido.'
            : `${invalid.length} IDs não encontrados em crm_bancas (ou de outro tenant) foram omitidos.`;
      }
    }

    const { error: upsertError } = await supabaseServiceRole
      .from('user_bancas')
      .upsert({ user_id: userId, banca_ids: idsToSave }, { onConflict: 'user_id' });

    if (upsertError) {
      console.error(`${LOG} Erro ao salvar user_bancas:`, upsertError);
      return errorResponse(upsertError.message || 'Erro ao atualizar bancas', 500);
    }

    const prevNorm = [...prevIds].map((x) => String(x).toLowerCase()).sort().join(',');
    const nextNorm = [...idsToSave].map((x) => String(x).toLowerCase()).sort().join(',');
    if (prevNorm !== nextNorm) {
      await recordHierarchyNetworkAudit({
        zaploto_id: profile.zaploto_id ?? null,
        actor_id: profile.id,
        actor_email: profile.email,
        actor_status: profile.status,
        action: 'user_bancas.set',
        target_user_id: userId,
        summary: `Bancas CRM (${targetProfile?.email || userId}): vínculo atualizado`,
        meta: {
          target_email: targetProfile?.email,
          target_status: targetProfile?.status,
          banca_ids_before: prevIds,
          banca_ids_after: idsToSave,
        },
      });
    }

    return successResponse(
      { banca_ids: idsToSave },
      omittedMessage ? `Bancas atualizadas. ${omittedMessage}` : 'Bancas atualizadas com sucesso'
    );
  } catch (err: unknown) {
    console.error(LOG, err);
    return serverErrorResponse(err);
  }
}

/**
 * GET /api/admin/users/[userId]/bancas - Lista as bancas do consultor/gerente (admin)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    await requireAdminOrSuporte(req);
    const { userId } = await params;

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    if (!profile || !STATUS_WITH_BANCAS.includes(profile.status || '')) {
      return successResponse({ banca_ids: [] });
    }

    const { data: row, error } = await supabaseServiceRole
      .from('user_bancas')
      .select('banca_ids')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      return errorResponse('Erro ao listar bancas', 500);
    }

    const banca_ids = Array.isArray(row?.banca_ids) ? (row.banca_ids as string[]) : [];
    return successResponse({ banca_ids });
  } catch (err: unknown) {
    return serverErrorResponse(err);
  }
}
