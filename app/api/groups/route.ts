import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { deduplicateGroupsByInstance, normalizeGroupId } from '@/lib/utils/group-utils';
import { checkInstanceAccess } from '@/lib/utils/instance-access';

function trimInstanceName(raw: string | null): string {
  return String(raw ?? '').trim();
}

/**
 * Monta query em `whatsapp_groups` para uma instância: próprio usuário + dono da instância
 * (grupos sincronizados pelo dono passam a aparecer para quem tem `checkInstanceAccess`).
 */
function whatsappGroupsQueryForInstanceAccess(params: {
  userId: string;
  instanceNameTrimmed: string;
  select: string;
  ownerUserId: string | null;
}) {
  const { userId, instanceNameTrimmed, select, ownerUserId } = params;
  let q = supabaseServiceRole
    .from('whatsapp_groups')
    .select(select)
    .eq('instance_name', instanceNameTrimmed);

  const owner = ownerUserId?.trim() || '';
  if (owner && owner !== userId) {
    q = q.or(`user_id.eq.${userId},user_id.eq.${owner}`);
  } else {
    q = q.eq('user_id', userId);
  }

  return q.order('group_subject', { ascending: true });
}

/**
 * GET /api/groups - Lista grupos salvos do usuário
 * - Sem params ou instanceName: deduplica por (instance_name, group_id); retorna { group_id, group_subject } (compat).
 * - allInstances=1: retorna todos os grupos em todas as instâncias: { group_id, group_subject, instance_name }[].
 * - evolutionShape=1 + instanceName: retorna { id, subject, pictureUrl, size }[] (após sync / fetch assíncrono).
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = req.nextUrl;
    const instanceNameRaw = searchParams.get('instanceName');
    const instanceName = trimInstanceName(instanceNameRaw);
    const allInstances = searchParams.get('allInstances') === '1';
    const evolutionShape = searchParams.get('evolutionShape') === '1';

    if (evolutionShape) {
      if (!instanceName || allInstances) {
        return errorResponse('evolutionShape=1 requer instanceName (e não combina com allInstances=1)', 400);
      }
      const hasAccess = await checkInstanceAccess(req, userId, instanceName);
      if (!hasAccess) {
        return errorResponse('Acesso negado a esta instância.', 403);
      }

      const { data: evoInst, error: evoErr } = await supabaseServiceRole
        .from('evolution_instances')
        .select('user_id')
        .eq('instance_name', instanceName)
        .eq('is_active', true)
        .maybeSingle();

      if (evoErr || !evoInst) {
        return errorResponse('Instância não encontrada', 404);
      }

      const ownerUserId = evoInst.user_id != null ? String(evoInst.user_id) : null;

      const { data, error } = await whatsappGroupsQueryForInstanceAccess({
        userId,
        instanceNameTrimmed: instanceName,
        ownerUserId,
        select: 'group_id, group_subject, picture_url, size',
      });

      if (error) {
        return errorResponse(`Erro ao buscar grupos: ${error.message}`);
      }

      const rows = (data || []) as unknown as {
        group_id: string;
        group_subject: string | null;
        picture_url: string | null;
        size: number | null;
      }[];
      const shaped = rows.map((row) => ({
        id: row.group_id,
        subject: row.group_subject ?? '',
        pictureUrl: row.picture_url ?? undefined,
        size: row.size ?? undefined,
      }));

      return successResponse(shaped, 'Grupos (formato Evolution)');
    }

    let query = supabaseServiceRole
      .from('whatsapp_groups')
      .select('group_id, group_subject, instance_name')
      .eq('user_id', userId)
      .order('group_subject', { ascending: true });

    if (instanceName && !allInstances) {
      const hasAccess = await checkInstanceAccess(req, userId, instanceName);
      if (!hasAccess) {
        return errorResponse('Acesso negado a esta instância.', 403);
      }

      const { data: evoInst, error: evoErr } = await supabaseServiceRole
        .from('evolution_instances')
        .select('user_id')
        .eq('instance_name', instanceName)
        .eq('is_active', true)
        .maybeSingle();

      if (evoErr || !evoInst) {
        return errorResponse('Instância não encontrada', 404);
      }

      const ownerUserId = evoInst.user_id != null ? String(evoInst.user_id) : null;
      query = whatsappGroupsQueryForInstanceAccess({
        userId,
        instanceNameTrimmed: instanceName,
        ownerUserId,
        select: 'group_id, group_subject, instance_name',
      }) as unknown as typeof query;
    }

    const { data, error } = await query;

    if (error) {
      return errorResponse(`Erro ao buscar grupos: ${error.message}`);
    }

    const raw = (data || []) as { group_id: string; group_subject: string | null; instance_name?: string }[];
    if (allInstances) {
      const deduped = deduplicateGroupsByInstance(raw);
      return successResponse(deduped.map((g) => ({ group_id: g.group_id, group_subject: g.group_subject ?? g.group_id, instance_name: g.instance_name ?? '' })));
    }

    const deduped = deduplicateGroupsByInstance(raw);
    const result = deduped.map(({ group_id, group_subject }) => ({ group_id, group_subject }));

    return successResponse(result);
  } catch (err: unknown) {
    return serverErrorResponse(err);
  }
}

/**
 * POST /api/groups - Salva um grupo (evita duplicatas: mesmo user + mesma instância + mesmo group_id)
 * Se o grupo já existir para o usuário na mesma instância, apenas atualiza (group_subject, etc.)
 * Group_id é normalizado para evitar duplicatas por variação de formato.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { instanceName, groupId, groupSubject, pictureUrl, size } = body;

    const instanceTrimmed = trimInstanceName(instanceName);
    if (!instanceTrimmed || !groupId) {
      return errorResponse('instanceName e groupId são obrigatórios', 400);
    }

    const hasAccess = await checkInstanceAccess(req, userId, instanceTrimmed);
    if (!hasAccess) {
      return errorResponse('Acesso negado a esta instância.', 403);
    }

    const normalizedGroupId = normalizeGroupId(groupId);
    if (!normalizedGroupId) {
      return errorResponse('groupId inválido', 400);
    }

    // Verifica se já existe (user + instance + group_id) para evitar duplicata
    const { data: existingRows, error: existingErr } = await supabaseServiceRole
      .from('whatsapp_groups')
      .select('id, group_subject, picture_url, size')
      .eq('user_id', userId)
      .eq('instance_name', instanceTrimmed)
      .eq('group_id', normalizedGroupId)
      .limit(1);

    if (existingErr) {
      return errorResponse(`Erro ao verificar grupo: ${existingErr.message}`);
    }

    const existing = existingRows?.[0];

    if (existing) {
      // Grupo já na base: não inserir de novo. Atualiza apenas se nome/outros campos mudaram (id do grupo mantém-se).
      const subjectChanged = (existing.group_subject ?? null) !== (groupSubject ?? null);
      const pictureChanged = (existing.picture_url ?? null) !== (pictureUrl ?? null);
      const sizeChanged = (existing.size ?? null) !== (size ?? null);
      if (subjectChanged || pictureChanged || sizeChanged) {
        const { error: updateError } = await supabaseServiceRole
          .from('whatsapp_groups')
          .update({
            group_subject: groupSubject || null,
            picture_url: pictureUrl || null,
            size: size ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);

        if (updateError) {
          return errorResponse(`Erro ao atualizar grupo: ${updateError.message}`);
        }
        return successResponse(null, 'Grupo atualizado (nome/outros campos alterados)');
      }
      return successResponse(null, 'Grupo já existe no banco (sem alterações)');
    }

    // Não existe: insere
    const { data, error } = await supabaseServiceRole
      .from('whatsapp_groups')
      .insert({
        user_id: userId,
        instance_name: instanceTrimmed,
        group_id: normalizedGroupId,
        group_subject: groupSubject || null,
        picture_url: pictureUrl || null,
        size: size || null,
      })
      .select()
      .single();

    if (error) {
      // Fallback: se for erro de duplicata (constraint existente), considera sucesso
      if ((error as any).code === '23505') {
        return successResponse(null, 'Grupo já existe no banco');
      }
      return errorResponse(`Erro ao salvar grupo: ${error.message}`);
    }

    return successResponse(data, 'Grupo salvo com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

