/**
 * API Admin: /api/admin/maturation/master-instances
 *
 * POST: Adiciona uma instância ao maturador interno (master_instances)
 * DELETE: Remove uma instância do maturador (por evolution_instance_id)
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const runtime = 'nodejs';

async function requireAdmin(userId: string) {
  const { data: profile } = await supabaseServiceRole
    .from('profiles')
    .select('status')
    .eq('id', userId)
    .single();
  const canAccess = profile?.status === 'super_admin' || profile?.status === 'admin' || profile?.status === 'dono_banca';
  if (!canAccess) {
    throw new Error('Acesso negado. Apenas administradores.');
  }
}

/**
 * POST - Adiciona instância ao maturador (cria registro em master_instances)
 * Body: { evolution_instance_id: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    await requireAdmin(userId);

    const body = await req.json();
    const evolutionInstanceId = body?.evolution_instance_id;

    if (!evolutionInstanceId || typeof evolutionInstanceId !== 'string') {
      return errorResponse('evolution_instance_id é obrigatório', 400);
    }

    const { data: instance, error: fetchErr } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, instance_name, is_active')
      .eq('id', evolutionInstanceId)
      .single();

    if (fetchErr || !instance) {
      return errorResponse('Instância não encontrada', 404);
    }

    const { data: existing } = await supabaseServiceRole
      .from('master_instances')
      .select('id')
      .eq('evolution_instance_id', evolutionInstanceId)
      .maybeSingle();

    if (existing) {
      return errorResponse('Esta instância já está no maturador', 400);
    }

    const { data: created, error: insertErr } = await supabaseServiceRole
      .from('master_instances')
      .insert({
        evolution_instance_id: evolutionInstanceId,
        is_active: true,
        health_score: 100,
      })
      .select('id, evolution_instance_id, is_active')
      .single();

    if (insertErr) {
      return errorResponse(`Erro ao adicionar ao maturador: ${insertErr.message}`, 500);
    }

    return successResponse(
      { id: created.id, evolution_instance_id: created.evolution_instance_id },
      'Instância adicionada ao maturador'
    );
  } catch (err: any) {
    if (err.message === 'Acesso negado. Apenas administradores.') {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}

/**
 * DELETE - Remove instância do maturador
 * Body: { evolution_instance_id: string }
 */
export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    await requireAdmin(userId);

    const body = await req.json().catch(() => ({}));
    const evolutionInstanceId = body?.evolution_instance_id ?? new URL(req.url).searchParams.get('evolution_instance_id');

    if (!evolutionInstanceId || typeof evolutionInstanceId !== 'string') {
      return errorResponse('evolution_instance_id é obrigatório (body ou query)', 400);
    }

    const { data: row, error: findErr } = await supabaseServiceRole
      .from('master_instances')
      .select('id')
      .eq('evolution_instance_id', evolutionInstanceId)
      .maybeSingle();

    if (findErr) {
      return errorResponse(`Erro ao buscar: ${findErr.message}`, 500);
    }

    if (!row) {
      return errorResponse('Instância não está no maturador', 404);
    }

    const { error: deleteErr } = await supabaseServiceRole
      .from('master_instances')
      .delete()
      .eq('id', row.id);

    if (deleteErr) {
      return errorResponse(`Erro ao remover do maturador: ${deleteErr.message}`, 500);
    }

    return successResponse(null, 'Instância removida do maturador');
  } catch (err: any) {
    if (err.message === 'Acesso negado. Apenas administradores.') {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
