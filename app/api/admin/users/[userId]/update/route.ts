import { NextRequest } from 'next/server';
import { requireAdminOrSuporte } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { validateHierarchy, hasHierarchyCycle, UserStatus } from '@/lib/middleware/permissions';
import bcrypt from 'bcryptjs';

/**
 * PATCH /api/admin/users/[userId]/update - Atualiza um usuário (incluindo status e enroller)
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    await requireAdminOrSuporte(req);
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
    await requireAdminOrSuporte(req);
    const { userId } = await params;

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

    return successResponse({ id: userId }, 'Usuário removido com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

