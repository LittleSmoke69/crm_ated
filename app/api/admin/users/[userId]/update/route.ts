import { NextRequest } from 'next/server';
import { requireAdminOrSuporte } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { validateHierarchy, hasHierarchyCycle, UserStatus } from '@/lib/middleware/permissions';
import { recordHierarchyNetworkAudit } from '@/lib/admin/hierarchy-network-audit';
import bcrypt from 'bcryptjs';

/**
 * PATCH /api/admin/users/[userId]/update - Atualiza um usuário (incluindo status e enroller)
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { profile: actorProfile } = await requireAdminOrSuporte(req);
    const { userId } = await params;
    const body = await req.json();
    const { email, fullName, password, status, enroller, isActive, bancaName, bancaUrl } = body;

    // Busca usuário atual
    const { data: currentUser, error: fetchError } = await supabaseServiceRole
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (fetchError || !currentUser) {
      return errorResponse('Usuário não encontrado', 404);
    }

    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    // Atualiza email se fornecido
    if (email && email !== currentUser.email) {
      // Verifica se novo email já existe
      const { data: existing } = await supabaseServiceRole
        .from('profiles')
        .select('id')
        .eq('email', email.trim().toLowerCase())
        .maybeSingle();

      if (existing && existing.id !== userId) {
        return errorResponse('Email já cadastrado', 400);
      }

      updateData.email = email.trim().toLowerCase();
    }

    // Atualiza nome se fornecido
    if (fullName !== undefined) {
      updateData.full_name = fullName || null;
    }

    // Atualiza senha se fornecida
    if (password) {
      updateData.password_hash = bcrypt.hashSync(password, bcrypt.genSaltSync(10));
    }

    // Atualiza status e enroller se fornecidos (dono/superior opcional para gerente: "" ou null = sem enroller)
    const newStatus = status || currentUser.status;
    const rawEnroller = enroller !== undefined ? enroller : currentUser.enroller;
    const newEnroller =
      rawEnroller != null && String(rawEnroller).trim() !== ''
        ? String(rawEnroller).trim()
        : null;

    if (status || enroller !== undefined) {
      // Garante que enroller não seja ID de banca (crm_bancas) - deve ser profile id
      if (newEnroller) {
        const [profileRes, bancaRes] = await Promise.all([
          supabaseServiceRole.from('profiles').select('id').eq('id', newEnroller).maybeSingle(),
          supabaseServiceRole.from('crm_bancas').select('id').eq('id', newEnroller).maybeSingle(),
        ]);
        const enrollerProfile = profileRes.data;
        const bancaById = bancaRes.data;

        if (!enrollerProfile && bancaById) {
          return errorResponse(
            'O valor informado como superior (gerente/dono) é um ID de banca. Selecione um Gerente ou Dono de Banca no dropdown, não a banca.',
            400
          );
        }
      }

      const validation = await validateHierarchy(userId, newStatus as UserStatus, newEnroller);
      if (!validation.valid) {
        return errorResponse(validation.error || 'Hierarquia inválida', 400);
      }

      const hasCycle = await hasHierarchyCycle(userId, newEnroller);
      if (hasCycle) {
        return errorResponse('Ciclo detectado na hierarquia', 400);
      }

      if (status) updateData.status = status;
      if (enroller !== undefined) updateData.enroller = newEnroller;
    }

    // Atualiza campos de banca (somente quando fornecidos; tipicamente para dono_banca)
    if (bancaName !== undefined) {
      updateData.banca_name = bancaName || null;
    }
    if (bancaUrl !== undefined) {
      updateData.banca_url = bancaUrl || null;
    }

    // Atualiza perfil
    const { data: updatedUser, error: updateError } = await supabaseServiceRole
      .from('profiles')
      .update(updateData)
      .eq('id', userId)
      .select('id, email, full_name, status, enroller, created_at, updated_at')
      .single();

    if (updateError) {
      return errorResponse(`Erro ao atualizar usuário: ${updateError.message}`, 400);
    }

    // Atualiza is_active nas configurações se fornecido
    if (typeof isActive === 'boolean') {
      await supabaseServiceRole
        .from('user_settings')
        .upsert({
          user_id: userId,
          is_active: isActive,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id',
        });
    }

    const auditBits: string[] = [];
    if (updateData.status) auditBits.push(`cargo ${currentUser.status} → ${updateData.status}`);
    if (enroller !== undefined) auditBits.push('superior (enroller) alterado');
    if (updateData.email) auditBits.push('email alterado');
    if (updateData.full_name !== undefined) auditBits.push('nome alterado');
    if (updateData.password_hash) auditBits.push('senha alterada');
    if (updateData.banca_name !== undefined || updateData.banca_url !== undefined) auditBits.push('nome/url da banca');
    if (typeof isActive === 'boolean') auditBits.push(isActive ? 'conta ativada' : 'conta desativada');
    if (auditBits.length > 0) {
      await recordHierarchyNetworkAudit({
        zaploto_id: actorProfile.zaploto_id ?? null,
        actor_id: actorProfile.id,
        actor_email: actorProfile.email,
        actor_status: actorProfile.status,
        action: 'user.update',
        target_user_id: userId,
        summary: `${currentUser.email}: ${auditBits.join('; ')}`,
        meta: {
          target_email: currentUser.email,
          target_was_status: currentUser.status,
          fields: auditBits,
        },
      });
    }

    return successResponse(updatedUser, 'Usuário atualizado com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * DELETE /api/admin/users/[userId]/update - Remove um usuário
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { profile: actorProfile } = await requireAdminOrSuporte(req);
    const { userId } = await params;

    const { data: victim } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, status')
      .eq('id', userId)
      .maybeSingle();

    // Verifica se usuário tem subordinados
    const { data: subordinates } = await supabaseServiceRole
      .from('profiles')
      .select('id')
      .eq('enroller', userId);

    if (subordinates && subordinates.length > 0) {
      return errorResponse(
        'Não é possível remover usuário com subordinados. Reatribua os subordinados primeiro.',
        400
      );
    }

    // Remove configurações e vínculos de bancas (consultor/gerente)
    await supabaseServiceRole
      .from('user_settings')
      .delete()
      .eq('user_id', userId);

    await supabaseServiceRole
      .from('user_bancas')
      .delete()
      .eq('user_id', userId);

    // Remove usuário
    const { error: deleteError } = await supabaseServiceRole
      .from('profiles')
      .delete()
      .eq('id', userId);

    if (deleteError) {
      return errorResponse(`Erro ao remover usuário: ${deleteError.message}`, 400);
    }

    if (victim) {
      await recordHierarchyNetworkAudit({
        zaploto_id: actorProfile.zaploto_id ?? null,
        actor_id: actorProfile.id,
        actor_email: actorProfile.email,
        actor_status: actorProfile.status,
        action: 'user.delete',
        target_user_id: userId,
        summary: `Removeu usuário ${victim.email} (${victim.status})`,
        meta: { target_email: victim.email, target_status: victim.status },
      });
    }

    return successResponse({ id: userId }, 'Usuário removido com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

