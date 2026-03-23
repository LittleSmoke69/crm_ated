/**
 * GET /api/gerente/atendimento-chat/instances — lista vínculos do gerente
 * POST /api/gerente/atendimento-chat/instances — cria instância Evolution + vínculo
 */

import { NextRequest } from 'next/server';
import { requireStatus, getSubordinates } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { createEvolutionChatInstance } from '@/lib/server/evolution-chat-instance-create';
import { userHasCrmBanca } from '@/lib/utils/user-bancas';
import {
  normalizeConsultorUserIdsColumn,
  parseConsultorUserIdsForCreate,
  parseConsultorUserIdsPatch,
} from '@/lib/utils/atendimento-consultores';
import { validateConsultorIdsForAtendimentoAssignment } from '@/lib/server/atendimento-assignment-consultores';

function normalizeCrmBancaId(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  return String(raw).trim() || null;
}

export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireStatus(req, ['gerente', 'dono_banca', 'super_admin', 'admin']);

    let listQuery = supabaseServiceRole
      .from('atendimento_chat_assignments')
      .select(
        `
        id,
        evolution_instance_id,
        gerente_user_id,
        consultor_user_ids,
        crm_banca_id,
        created_at,
        updated_at,
        crm_bancas ( id, name ),
        evolution_instances (
          id,
          instance_name,
          status,
          is_active,
          is_chat_instance
        )
      `
      )
      .order('created_at', { ascending: false });

    const st = (profile.status || '').toLowerCase();
    if (st === 'gerente') {
      listQuery = listQuery.eq('gerente_user_id', userId);
    } else if (st === 'dono_banca') {
      const subordinates = await getSubordinates(userId);
      const gerenteIds = subordinates
        .filter((s) => (s.status || '').toLowerCase() === 'gerente')
        .map((s) => s.id);
      if (gerenteIds.length === 0) {
        return successResponse([]);
      }
      listQuery = listQuery.in('gerente_user_id', gerenteIds);
    } else {
      const filterGerente = req.nextUrl.searchParams.get('gerente_id')?.trim();
      if (filterGerente) {
        listQuery = listQuery.eq('gerente_user_id', filterGerente);
      }
    }

    const { data: rows, error } = await listQuery;

    if (error) {
      return errorResponse(`Erro ao listar: ${error.message}`, 500);
    }

    const baseRows = rows || [];
    const consultorIds = [
      ...new Set(
        baseRows.flatMap((r: any) => normalizeConsultorUserIdsColumn(r.consultor_user_ids))
      ),
    ] as string[];

    let consultorNameById = new Map<string, string>();
    if (consultorIds.length > 0) {
      const { data: consultores } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email')
        .in('id', consultorIds);

      consultorNameById = new Map(
        (consultores || []).map((c: any) => [c.id, c.full_name || c.email || c.id])
      );
    }

    const enrichedRows = baseRows.map((r: any) => {
      const bancaJoin = r.crm_bancas;
      const crm_banca_name =
        bancaJoin && typeof bancaJoin === 'object' && !Array.isArray(bancaJoin)
          ? (bancaJoin as { name?: string }).name ?? null
          : Array.isArray(bancaJoin) && bancaJoin[0]
            ? (bancaJoin[0] as { name?: string }).name ?? null
            : null;
      const { crm_bancas: _omit, ...rest } = r;
      const cids = normalizeConsultorUserIdsColumn(r.consultor_user_ids);
      const consultores = cids.map((id) => ({
        id,
        name: consultorNameById.get(id) || id,
      }));
      const consultor_name =
        consultores.length === 0
          ? null
          : consultores.length === 1
            ? consultores[0].name
            : `${consultores.length} consultores`;
      return {
        ...rest,
        crm_banca_name,
        consultores,
        consultor_name,
      };
    });

    return successResponse(enrichedRows);
  } catch (err: unknown) {
    const msg = (err as Error)?.message || '';
    if (msg.includes('Acesso negado')) {
      return errorResponse(msg, 403);
    }
    return serverErrorResponse(err as Error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireStatus(req, ['gerente', 'super_admin', 'admin']);

    const body = await req.json().catch(() => ({})) as {
      link_existing?: boolean;
      evolution_instance_id?: string;
      evolution_api_id?: string;
      instance_name?: string;
      maturation_type?: string;
      workspace_id?: string | null;
      consultor_user_id?: string | null;
      consultor_user_ids?: string[] | null;
      gerente_user_id?: string | null;
      crm_banca_id?: string | null;
    };

    const st = (profile.status || '').toLowerCase();

    /** Vincula instância Evolution já existente (dono = gerente) ao atendimento, com consultor opcional */
    if (body.link_existing === true) {
      const instanceId = body.evolution_instance_id?.trim();
      if (!instanceId) {
        return errorResponse('evolution_instance_id é obrigatório', 400);
      }
      let gerenteOwnerId = userId;
      if (st === 'super_admin' || st === 'admin') {
        if (!body.gerente_user_id?.trim()) {
          return errorResponse('gerente_user_id é obrigatório quando o solicitante é admin/super_admin', 400);
        }
        gerenteOwnerId = body.gerente_user_id.trim();
      }

      const { data: instance, error: instErr } = await supabaseServiceRole
        .from('evolution_instances')
        .select('id, user_id, is_active')
        .eq('id', instanceId)
        .maybeSingle();

      if (instErr || !instance) {
        return errorResponse('Instância não encontrada', 404);
      }
      if (instance.is_active !== true) {
        return errorResponse('Instância inativa não pode ser vinculada', 400);
      }
      if (st === 'gerente' && instance.user_id !== userId) {
        return errorResponse('Esta instância não pertence à sua conta.', 403);
      }
      if ((st === 'super_admin' || st === 'admin') && instance.user_id !== gerenteOwnerId) {
        return errorResponse('A instância não pertence ao gerente informado.', 400);
      }

      const crm_banca_id = normalizeCrmBancaId(body.crm_banca_id);
      if (crm_banca_id) {
        const owns = await userHasCrmBanca(gerenteOwnerId, crm_banca_id);
        if (!owns) {
          return errorResponse('Banca não disponível para este gerente.', 403);
        }
      }

      const consultorIdsNewRow = parseConsultorUserIdsForCreate(body);

      const { data: existing, error: exErr } = await supabaseServiceRole
        .from('atendimento_chat_assignments')
        .select('id, gerente_user_id, consultor_user_ids, crm_banca_id')
        .eq('evolution_instance_id', instanceId)
        .maybeSingle();

      if (exErr) {
        return errorResponse(`Erro ao consultar vínculo: ${exErr.message}`, 500);
      }

      if (existing) {
        if (existing.gerente_user_id !== gerenteOwnerId) {
          return errorResponse('Esta instância já possui vínculo de atendimento com outro gerente.', 409);
        }
        const patchConsultor =
          'consultor_user_ids' in body || 'consultor_user_id' in body;
        const patchBanca = 'crm_banca_id' in body;
        if (patchConsultor || patchBanca) {
          let nextIds = normalizeConsultorUserIdsColumn(existing.consultor_user_ids);
          let nextBanca: string | null = existing.crm_banca_id ?? null;
          if (patchBanca) {
            nextBanca = crm_banca_id;
          }
          if (patchConsultor) {
            nextIds = parseConsultorUserIdsPatch(body);
          } else if (patchBanca) {
            nextIds = [];
          }
          if (nextBanca) {
            const owns = await userHasCrmBanca(gerenteOwnerId, nextBanca);
            if (!owns) {
              return errorResponse('Banca não disponível para este gerente.', 403);
            }
          }
          if (nextIds.length > 0) {
            const val = await validateConsultorIdsForAtendimentoAssignment(
              gerenteOwnerId,
              nextIds,
              nextBanca
            );
            if (!val.ok) return errorResponse(val.message, val.status);
          }
          const updatePayload: Record<string, unknown> = {
            updated_at: new Date().toISOString(),
          };
          if (patchBanca) {
            updatePayload.crm_banca_id = nextBanca;
          }
          if (patchConsultor || patchBanca) {
            updatePayload.consultor_user_ids = nextIds;
          }
          const { data: updated, error: upErr } = await supabaseServiceRole
            .from('atendimento_chat_assignments')
            .update(updatePayload)
            .eq('id', existing.id)
            .select()
            .single();
          if (upErr) {
            return errorResponse(`Erro ao atualizar vínculo: ${upErr.message}`, 500);
          }
          return successResponse({ assignment: updated });
        }
        return successResponse({ assignment: existing });
      }

      if (consultorIdsNewRow.length > 0) {
        const v = await validateConsultorIdsForAtendimentoAssignment(
          gerenteOwnerId,
          consultorIdsNewRow,
          crm_banca_id
        );
        if (!v.ok) return errorResponse(v.message, v.status);
      }

      const { data: inserted, error: insErr } = await supabaseServiceRole
        .from('atendimento_chat_assignments')
        .insert({
          evolution_instance_id: instanceId,
          gerente_user_id: gerenteOwnerId,
          consultor_user_ids: consultorIdsNewRow,
          crm_banca_id,
        })
        .select()
        .single();

      if (insErr) {
        return errorResponse(`Erro ao criar vínculo: ${insErr.message}`, 500);
      }

      return successResponse({ assignment: inserted }, 'Vínculo de atendimento registrado');
    }

    const {
      evolution_api_id,
      instance_name,
      maturation_type,
      workspace_id,
      crm_banca_id: bodyCrmBanca,
    } = body;
    const newInstanceCrmBancaId = normalizeCrmBancaId(bodyCrmBanca);
    const createConsultorIds = parseConsultorUserIdsForCreate(body);

    if (!evolution_api_id || !instance_name?.trim()) {
      return errorResponse('evolution_api_id e instance_name são obrigatórios', 400);
    }

    let gerenteOwnerId = userId;
    if (st === 'super_admin' || st === 'admin') {
      const gid = body.gerente_user_id?.trim();
      if (!gid) {
        return errorResponse('gerente_user_id é obrigatório quando o criador é admin/super_admin', 400);
      }
      gerenteOwnerId = gid;
    }

    if (newInstanceCrmBancaId) {
      const owns = await userHasCrmBanca(gerenteOwnerId, newInstanceCrmBancaId);
      if (!owns) {
        return errorResponse('Banca não disponível para este gerente.', 403);
      }
    }

    if (createConsultorIds.length > 0) {
      const val = await validateConsultorIdsForAtendimentoAssignment(
        gerenteOwnerId,
        createConsultorIds,
        newInstanceCrmBancaId
      );
      if (!val.ok) return errorResponse(val.message, val.status);
    }

    const maturationTypeValue = maturation_type === 'virgem' ? 'virgem' : 'maturado';

    const { data: gerenteProfile } = await supabaseServiceRole
      .from('profiles')
      .select('zaploto_id')
      .eq('id', gerenteOwnerId)
      .single();

    const result = await createEvolutionChatInstance({
      evolutionApiId: evolution_api_id,
      instanceName: instance_name.trim(),
      ownerUserId: gerenteOwnerId,
      workspaceId: workspace_id ?? null,
      maturationType: maturationTypeValue,
      zaplotoId: gerenteProfile?.zaploto_id ?? null,
    });

    if (!result.ok) {
      return errorResponse(result.error, result.status);
    }

    const instanceId = String(result.instance.id);

    const { error: assignError } = await supabaseServiceRole.from('atendimento_chat_assignments').insert({
      evolution_instance_id: instanceId,
      gerente_user_id: gerenteOwnerId,
      consultor_user_ids: createConsultorIds,
      crm_banca_id: newInstanceCrmBancaId,
    });

    if (assignError) {
      return errorResponse(`Instância criada, mas falha ao registrar vínculo: ${assignError.message}`, 500);
    }

    return successResponse(
      {
        instance: result.instance,
        qr_code: result.qr_code,
        evolution_data: result.evolution_data,
        warning: result.warning,
      },
      result.warning ? 'Instância criada com aviso' : 'Instância de atendimento criada com sucesso'
    );
  } catch (err: unknown) {
    const msg = (err as Error)?.message || '';
    if (msg.includes('Acesso negado')) {
      return errorResponse(msg, 403);
    }
    return serverErrorResponse(err as Error);
  }
}
