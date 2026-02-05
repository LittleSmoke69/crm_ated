import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * Verifica se o usuário tem acesso a uma instância
 * @param userId ID do usuário
 * @param instanceName Nome da instância
 * @returns true se o usuário tem acesso (é dono ou admin), false caso contrário
 */
export async function checkInstanceAccess(userId: string, instanceName: string): Promise<boolean> {
  try {
    console.log(`🔍 [checkInstanceAccess] Verificando acesso - userId: ${userId}, instanceName: ${instanceName}`);
    
    // Verifica se é admin
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

    const isAdmin = profile?.status === 'admin';

    // Se for admin, tem acesso a todas as instâncias
    if (isAdmin) {
      console.log(`✅ [checkInstanceAccess] Usuário ${userId} é admin - acesso permitido`);
      return true;
    }

    console.log(`🔍 [checkInstanceAccess] Usuário ${userId} não é admin - verificando se é dono da instância ${instanceName}`);

    // Se não for admin, verifica se é dono da instância
    const { data: instance, error: instanceError } = await supabaseServiceRole
      .from('evolution_instances')
      .select('user_id, id, instance_name, is_active')
      .eq('instance_name', instanceName)
      .eq('is_active', true)
      .single();

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

    // Se não encontrou a instância, não tem acesso
    if (!instance) {
      console.warn(`⚠️ [checkInstanceAccess] Instância ${instanceName} não encontrada ou não está ativa`);
      return false;
    }

    // Se user_id for null (instância antiga), não permite acesso
    if (instance.user_id === null) {
      console.warn(`⚠️ [checkInstanceAccess] Instância ${instanceName} tem user_id null - acesso negado`);
      return false;
    }

    // Verifica se o user_id da instância corresponde ao usuário
    const hasAccess = instance.user_id === userId;
    console.log(`🔍 [checkInstanceAccess] Comparação de user_id:`, {
      instanceUserId: instance.user_id,
      requestUserId: userId,
      match: hasAccess,
    });

    if (hasAccess) {
      console.log(`✅ [checkInstanceAccess] Usuário ${userId} é dono da instância ${instanceName} - acesso permitido`);
    } else {
      console.warn(`⚠️ [checkInstanceAccess] Usuário ${userId} NÃO é dono da instância ${instanceName} (dono: ${instance.user_id}) - acesso negado`);
    }

    return hasAccess;
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

