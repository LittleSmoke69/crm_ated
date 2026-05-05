/**
 * GET /api/instances/summary
 * Retorna resumo das instâncias do usuário: nome, telefone, status e grupos vinculados (para modal tabelado).
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getSubordinates, getUserProfile } from '@/lib/middleware/permissions';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const fullProfile = await getUserProfile(userId);
    if (!fullProfile) return errorResponse('Perfil não encontrado', 404);
    const effectiveZaplotoId = await getEffectiveZaplotoId(req, fullProfile);

    const { data: shareRowsForMe } = await supabaseServiceRole
      .from('evolution_instance_shared_users')
      .select('evolution_instance_id')
      .eq('user_id', userId);
    const sharedWithMeIds = (shareRowsForMe || []).map(
      (r: { evolution_instance_id: string }) => r.evolution_instance_id
    );

    const userStatus = fullProfile.status;
    const isSuperAdmin = userStatus === 'super_admin';
    const isAdmin = userStatus === 'admin' || isSuperAdmin;
    const isDonoBanca = userStatus === 'dono_banca';
    const isGerente = userStatus === 'gerente';
    let allowedUserIds: string[] = [userId];
    if (isDonoBanca || isGerente) {
      const subordinates = await getSubordinates(userId);
      allowedUserIds = [userId, ...subordinates.map((s: { id: string }) => s.id)];
    }

    let instancesQuery = supabaseServiceRole
      .from('evolution_instances')
      .select('id, instance_name, status, phone_number, user_id')
      .or('is_active.is.null,is_active.eq.true')
      .order('instance_name', { ascending: true });
    if (!isSuperAdmin) {
      instancesQuery = instancesQuery.eq('zaploto_id', effectiveZaplotoId);
    }
    if (!isAdmin) {
      const orParts: string[] = [`user_id.in.(${allowedUserIds.join(',')})`];
      if (sharedWithMeIds.length > 0) {
        orParts.push(`id.in.(${sharedWithMeIds.join(',')})`);
      }
      instancesQuery = instancesQuery.or(orParts.join(','));
    }
    const { data: instances, error: instErr } = await instancesQuery;

    if (instErr) return errorResponse('Erro ao buscar instâncias', 500);
    const instList = (instances || []) as { id: string; instance_name: string; status: string; phone_number?: string | null }[];

    const instanceNames = instList.map((i) => i.instance_name);
    if (instanceNames.length === 0) {
      return successResponse(
        instList.map((i) => ({
          instance_name: i.instance_name,
          phone: i.phone_number || null,
          status: i.status === 'ok' ? 'Conectada' : 'Desconectada',
          groups_count: 0,
        }))
      );
    }

    let groupsQ = supabaseServiceRole
      .from('whatsapp_groups')
      .select('instance_name, group_subject')
      .in('instance_name', instanceNames);
    if (!isSuperAdmin) {
      groupsQ = groupsQ.in('user_id', allowedUserIds);
    }
    const { data: groupsData } = await groupsQ;

    const groupsByInstance = new Map<string, string[]>();
    for (const g of groupsData || []) {
      const name = (g as any).instance_name;
      const subject = (g as any).group_subject || 'Sem nome';
      if (!groupsByInstance.has(name)) groupsByInstance.set(name, []);
      groupsByInstance.get(name)!.push(subject);
    }

    const summary = instList.map((i) => ({
      instance_name: i.instance_name,
      phone: i.phone_number || null,
      status: i.status === 'ok' ? 'Conectada' : 'Desconectada',
      groups_count: (groupsByInstance.get(i.instance_name) || []).length,
    }));

    return successResponse(summary);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
