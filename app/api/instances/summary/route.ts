/**
 * GET /api/instances/summary
 * Retorna resumo das instâncias do usuário: nome, telefone, status e grupos vinculados (para modal tabelado).
 */
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getSubordinates } from '@/lib/middleware/permissions';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();
    const isAdmin = profile?.status === 'admin';
    const isDonoBanca = profile?.status === 'dono_banca';
    const isGerente = profile?.status === 'gerente';
    let allowedUserIds: string[] = [userId];
    if (isDonoBanca || isGerente) {
      const subordinates = await getSubordinates(userId);
      allowedUserIds = [userId, ...subordinates.map((s: { id: string }) => s.id)];
    }

    let instancesQuery = supabaseServiceRole
      .from('evolution_instances')
      .select('id, instance_name, status, phone_number, user_id')
      .eq('is_active', true)
      .order('instance_name', { ascending: true });
    if (!isAdmin) instancesQuery = instancesQuery.in('user_id', allowedUserIds);
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

    const { data: groupsData } = await supabaseServiceRole
      .from('whatsapp_groups')
      .select('instance_name, group_subject')
      .in('user_id', allowedUserIds)
      .in('instance_name', instanceNames);

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
