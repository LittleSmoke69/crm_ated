import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { validateHierarchy, hasHierarchyCycle } from '@/lib/middleware/permissions';

/**
 * GET /api/admin/users - Lista todos os usuários com suas estatísticas
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    // Busca todos os usuários incluindo status e enroller
    const { data: users, error: usersError } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, status, enroller, created_at, last_seen_at, total_online_time')
      .order('created_at', { ascending: false });

    if (usersError) {
      return errorResponse(`Erro ao buscar usuários: ${usersError.message}`);
    }

    // Busca configurações e estatísticas de cada usuário
    const usersWithStats = await Promise.all(
      (users || []).map(async (user) => {
        const [
          { data: settings },
          { count: campaignsCount },
          { count: instancesCount },
          { count: contactsCount },
          { data: campaigns },
        ] = await Promise.all([
          supabaseServiceRole
            .from('user_settings')
            .select('*')
            .eq('user_id', user.id)
            .single(),
          supabaseServiceRole
            .from('campaigns')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id),
          supabaseServiceRole
            .from('whatsapp_instances')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id),
          supabaseServiceRole
            .from('searches')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id),
          supabaseServiceRole
            .from('campaigns')
            .select('processed_contacts, failed_contacts')
            .eq('user_id', user.id),
        ]);

        const totalProcessed = campaigns?.reduce((sum, c) => sum + (c.processed_contacts || 0), 0) || 0;
        const totalFailed = campaigns?.reduce((sum, c) => sum + (c.failed_contacts || 0), 0) || 0;

        return {
          ...user,
          settings: settings || {
            max_leads_per_day: 100,
            max_instances: 20,
            is_admin: false,
            is_active: true,
          },
          stats: {
            campaigns: campaignsCount || 0,
            instances: instancesCount || 0,
            contacts: contactsCount || 0,
            processed: totalProcessed,
            failed: totalFailed,
          },
        };
      })
    );

    return successResponse(usersWithStats);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * PATCH /api/admin/users - Atualiza configurações de um usuário
 */
export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin(req);

    const body = await req.json();
    const { targetUserId, maxLeadsPerDay, maxInstances, isActive, status, enroller, email, fullName, bancaName, bancaUrl } = body;

    if (!targetUserId) {
      return errorResponse('targetUserId é obrigatório', 400);
    }

    // Se status ou enroller ou email ou fullName ou banca foram fornecidos, valida/prepara atualização de perfil
    if (status || enroller !== undefined || email || fullName !== undefined || bancaName !== undefined || bancaUrl !== undefined) {
      const { data: currentUser } = await supabaseServiceRole
        .from('profiles')
        .select('status, enroller')
        .eq('id', targetUserId)
        .single();

      const newStatus = status || currentUser?.status;
      const newEnroller = enroller !== undefined ? enroller : currentUser?.enroller;

      if (status || enroller !== undefined) {
        // Valida hierarquia
        const validation = await validateHierarchy(targetUserId, newStatus, newEnroller || null);
        if (!validation.valid) {
          return errorResponse(validation.error || 'Hierarquia inválida', 400);
        }

        // Verifica ciclos
        const hasCycle = await hasHierarchyCycle(targetUserId, newEnroller || null);
        if (hasCycle) {
          return errorResponse('Ciclo detectado na hierarquia', 400);
        }
      }

      // Prepara objeto de atualização do perfil
      const profileUpdate: any = {
        updated_at: new Date().toISOString(),
      };
      if (status) profileUpdate.status = status;
      if (enroller !== undefined) profileUpdate.enroller = enroller || null;
      if (email) profileUpdate.email = email.trim().toLowerCase();
      if (fullName !== undefined) profileUpdate.full_name = fullName || null;
      if (bancaName !== undefined) profileUpdate.banca_name = bancaName || null;
      if (bancaUrl !== undefined) profileUpdate.banca_url = bancaUrl || null;

      const { error: profileError } = await supabaseServiceRole
        .from('profiles')
        .update(profileUpdate)
        .eq('id', targetUserId);

      if (profileError) {
        return errorResponse(`Erro ao atualizar perfil: ${profileError.message}`, 400);
      }
    }

    // Atualiza ou cria configurações
    const { data: existing } = await supabaseServiceRole
      .from('user_settings')
      .select('id')
      .eq('user_id', targetUserId)
      .single();

    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (typeof maxLeadsPerDay === 'number') {
      updateData.max_leads_per_day = maxLeadsPerDay;
    }

    if (typeof maxInstances === 'number') {
      updateData.max_instances = maxInstances;
    }

    if (typeof isActive === 'boolean') {
      updateData.is_active = isActive;
    }

    let result;
    if (existing) {
      // Atualiza existente
      const { data, error } = await supabaseServiceRole
        .from('user_settings')
        .update(updateData)
        .eq('user_id', targetUserId)
        .select()
        .single();

      if (error) {
        return errorResponse(`Erro ao atualizar configurações: ${error.message}`);
      }

      result = data;
    } else {
      // Cria novo
      const { data, error } = await supabaseServiceRole
        .from('user_settings')
        .insert({
          user_id: targetUserId,
          max_leads_per_day: maxLeadsPerDay || 100,
          max_instances: maxInstances || 20,
          is_active: isActive !== undefined ? isActive : true,
          ...updateData,
        })
        .select()
        .single();

      if (error) {
        return errorResponse(`Erro ao criar configurações: ${error.message}`);
      }

      result = data;
    }

    return successResponse(result, 'Configurações atualizadas com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

