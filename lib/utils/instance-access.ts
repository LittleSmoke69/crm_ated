import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * Verifica se o usuário tem acesso a uma instância
 * @param userId ID do usuário
 * @param instanceName Nome da instância
 * @returns true se o usuário tem acesso (é dono, admin ou perfil com acesso anti-spam), false caso contrário
 */
export async function checkInstanceAccess(userId: string, instanceName: string): Promise<boolean> {
  try {
    console.log(`🔍 [checkInstanceAccess] Verificando acesso - userId: ${userId}, instanceName: ${instanceName}`);
    
    const { data: profile, error: profileError } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    if (profileError) {
      console.error(`❌ [checkInstanceAccess] Erro ao buscar perfil do usuário ${userId}:`, profileError);
    }

    console.log(`🔍 [checkInstanceAccess] Perfil do usuário:`, {
      userId,
      profileStatus: profile?.status,
      profileError: profileError?.message,
    });

    // Acesso a todas as instâncias: perfis que usam anti-spam (admin ou Meu Anti-Spam) e precisam buscar grupos
    const canAccessAllInstances =
      profile?.status === 'super_admin' ||
      profile?.status === 'admin' ||
      profile?.status === 'auditoria' ||
      profile?.status === 'dono_banca' ||
      profile?.status === 'gerente' ||
      profile?.status === 'consultor';

    if (canAccessAllInstances) {
      console.log(`✅ [checkInstanceAccess] Usuário ${userId} (${profile?.status}) - acesso permitido`);
      return true;
    }

    console.log(`🔍 [checkInstanceAccess] Usuário ${userId} não é admin - verificando se é dono da instância ${instanceName}`);

    // Se não for admin, verifica se é dono da instância
    // maybeSingle evita PGRST116 quando outro usuário tem instância com mesmo nome
    const { data: instance, error: instanceError } = await supabaseServiceRole
      .from('evolution_instances')
      .select('user_id, id, instance_name, is_active')
      .eq('instance_name', instanceName)
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (instanceError) {
      console.error(`❌ [checkInstanceAccess] Erro ao buscar instância ${instanceName}:`, instanceError);
    }

    console.log(`🔍 [checkInstanceAccess] Dados da instância:`, {
      instanceName,
      instanceId: instance?.id,
      instanceUserId: instance?.user_id,
      instanceIsActive: instance?.is_active,
      instanceError: instanceError?.message,
      instanceFound: !!instance,
    });

    // Query já filtra por user_id: se retornou linha, o usuário é o dono.
    if (!instance) {
      console.warn(`⚠️ [checkInstanceAccess] Instância ${instanceName} não encontrada para o usuário ${userId}`);
      return false;
    }

    console.log(`✅ [checkInstanceAccess] Usuário ${userId} é dono da instância ${instanceName} - acesso permitido`);
    return true;
  } catch (error: any) {
    console.error(`❌ [checkInstanceAccess] Erro ao verificar acesso à instância:`, {
      userId,
      instanceName,
      error: error?.message,
      stack: error?.stack,
    });
    return false;
  }
}

