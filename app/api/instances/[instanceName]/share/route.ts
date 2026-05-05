import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { checkInstanceAccess } from '@/lib/utils/instance-access';

const DEFAULT_ZAPLOTO = '00000000-0000-0000-0000-000000000001';

function zapOk(instZap: string | null | undefined, eff: string) {
  if (!instZap) return eff === DEFAULT_ZAPLOTO;
  return instZap === eff;
}

async function getInstanceByName(instanceName: string) {
  const { data, error } = await supabaseServiceRole
    .from('evolution_instances')
    .select('id, user_id, zaploto_id, instance_name, is_active')
    .eq('instance_name', instanceName)
    .eq('is_active', true)
    .maybeSingle();
  if (error || !data) return null;
  return data as { id: string; user_id: string; zaploto_id: string | null };
}

function isAdminLike(status: string | null | undefined) {
  return status === 'super_admin' || status === 'admin' || status === 'auditoria';
}

/** Cargo usado para filtrar com quem pode compartilhar: dono usa o próprio; admin usa o cargo do dono da instância. */
async function resolveShareRoleAnchor(
  profileStatus: string | null | undefined,
  actingUserId: string,
  ownerId: string
): Promise<string | null> {
  if (isAdminLike(profileStatus) && ownerId !== actingUserId) {
    const { data: ow } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', ownerId)
      .maybeSingle();
    return (ow as { status?: string | null } | null)?.status ?? profileStatus ?? null;
  }
  return profileStatus ?? null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ instanceName: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { instanceName } = await params;
    const profile = await getUserProfile(userId);
    if (!profile) return errorResponse('Perfil não encontrado', 404);
    const effectiveZaplotoId = await getEffectiveZaplotoId(req, profile);

    const inst = await getInstanceByName(instanceName);
    if (!inst || !zapOk(inst.zaploto_id, effectiveZaplotoId)) {
      return errorResponse('Instância não encontrada', 404);
    }

    const hasAccess = await checkInstanceAccess(req, userId, instanceName);
    if (!hasAccess) return errorResponse('Acesso negado', 403);

    const eligible = req.nextUrl.searchParams.get('eligible') === '1';
    const ownerId = String(inst.user_id);

    if (eligible) {
      const canConfigure =
        isAdminLike(profile.status) || ownerId === userId;
      if (!canConfigure) return errorResponse('Apenas o dono ou administrador pode adicionar compartilhamentos', 403);

      const { data: shares } = await supabaseServiceRole
        .from('evolution_instance_shared_users')
        .select('user_id')
        .eq('evolution_instance_id', inst.id);
      const sharedUserIds = new Set((shares || []).map((s: { user_id: string }) => s.user_id));

      const roleAnchor = await resolveShareRoleAnchor(profile.status, userId, ownerId);
      if (!roleAnchor) return errorResponse('Não foi possível determinar o cargo para compartilhamento', 400);

      const { data: candidates, error: qErr } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name, status')
        .eq('zaploto_id', effectiveZaplotoId)
        .neq('id', ownerId);

      if (qErr) return errorResponse('Erro ao listar usuários', 500);

      const list = (candidates || []).filter((p: { id: string; status: string | null }) => {
        if (p.id === userId) return false;
        if (sharedUserIds.has(p.id)) return false;
        return String(p.status ?? '') === String(roleAnchor);
      });

      return successResponse(list);
    }

    const { data: rows, error } = await supabaseServiceRole
      .from('evolution_instance_shared_users')
      .select('id, user_id, created_at, shared_by_user_id')
      .eq('evolution_instance_id', inst.id);

    if (error) return errorResponse('Erro ao listar compartilhamentos', 500);

    const ids = (rows || []).map((r: { user_id: string }) => r.user_id);
    const profilesMap: Record<string, { email?: string; full_name?: string | null }> = {};
    if (ids.length) {
      const { data: profs } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name')
        .in('id', ids);
      for (const p of profs || []) {
        const row = p as { id: string; email?: string; full_name?: string | null };
        profilesMap[row.id] = { email: row.email, full_name: row.full_name };
      }
    }

    const enriched = (rows || []).map(
      (r: { id: string; user_id: string; created_at: string; shared_by_user_id: string | null }) => ({
        ...r,
        profile: profilesMap[r.user_id] ?? null,
      })
    );

    return successResponse({ shares: enriched });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return errorResponse(msg, 401);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ instanceName: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { instanceName } = await params;
    const body = await req.json();
    const targetUserId = String(body.target_user_id || '').trim();
    if (!targetUserId) return errorResponse('target_user_id é obrigatório', 400);

    const profile = await getUserProfile(userId);
    if (!profile) return errorResponse('Perfil não encontrado', 404);
    const effectiveZaplotoId = await getEffectiveZaplotoId(req, profile);

    const inst = await getInstanceByName(instanceName);
    if (!inst || !zapOk(inst.zaploto_id, effectiveZaplotoId)) {
      return errorResponse('Instância não encontrada', 404);
    }

    const ownerId = String(inst.user_id);
    const canConfigure = isAdminLike(profile.status) || ownerId === userId;
    if (!canConfigure) return errorResponse('Apenas o dono ou administrador pode compartilhar', 403);

    if (targetUserId === ownerId) return errorResponse('O dono já tem acesso', 400);

    const { data: target } = await supabaseServiceRole
      .from('profiles')
      .select('id, status, zaploto_id')
      .eq('id', targetUserId)
      .maybeSingle();

    if (!target) return errorResponse('Usuário não encontrado', 404);

    const tz = (target as { zaploto_id?: string | null }).zaploto_id || DEFAULT_ZAPLOTO;
    if (tz !== effectiveZaplotoId) {
      return errorResponse('O usuário precisa pertencer ao mesmo white label', 400);
    }

    const roleAnchor = await resolveShareRoleAnchor(profile.status, userId, ownerId);
    if (!roleAnchor) return errorResponse('Não foi possível determinar o cargo para compartilhamento', 400);

    if (String((target as { status?: string | null }).status ?? '') !== String(roleAnchor)) {
      return errorResponse('Só é possível compartilhar com usuários do mesmo cargo (em relação ao dono da instância)', 400);
    }

    const { error: insErr } = await supabaseServiceRole.from('evolution_instance_shared_users').insert({
      evolution_instance_id: inst.id,
      user_id: targetUserId,
      shared_by_user_id: userId,
    });

    if (insErr) {
      if (insErr.code === '23505') return errorResponse('Este usuário já tem acesso compartilhado', 400);
      return errorResponse(insErr.message, 500);
    }

    return successResponse({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return errorResponse(msg, 401);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ instanceName: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { instanceName } = await params;
    const removeUserId = req.nextUrl.searchParams.get('user_id')?.trim();
    if (!removeUserId) return errorResponse('user_id é obrigatório', 400);

    const profile = await getUserProfile(userId);
    if (!profile) return errorResponse('Perfil não encontrado', 404);
    const effectiveZaplotoId = await getEffectiveZaplotoId(req, profile);

    const inst = await getInstanceByName(instanceName);
    if (!inst || !zapOk(inst.zaploto_id, effectiveZaplotoId)) {
      return errorResponse('Instância não encontrada', 404);
    }

    const ownerId = String(inst.user_id);
    const canConfigure = isAdminLike(profile.status) || ownerId === userId;
    const selfLeave = removeUserId === userId;

    if (!canConfigure && !selfLeave) {
      return errorResponse('Sem permissão para remover este acesso', 403);
    }

    const { error: delErr } = await supabaseServiceRole
      .from('evolution_instance_shared_users')
      .delete()
      .eq('evolution_instance_id', inst.id)
      .eq('user_id', removeUserId);

    if (delErr) return errorResponse(delErr.message, 500);
    return successResponse({ removed: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return errorResponse(msg, 401);
  }
}
