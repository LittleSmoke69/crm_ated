import { supabaseServiceRole } from './supabase-service';

/**
 * Serviço para reset diário de contadores das instâncias Evolution
 * Deve ser executado diariamente (recomendado: 00:00 no fuso de Recife/Brasil)
 */
export class DailyResetService {
  /**
   * Reseta contadores diários de todas as instâncias ativas
   * Define fuso horário para Recife/Brasil (America/Recife)
   */
  async resetDailyCounters(): Promise<{
    success: boolean;
    resetCount: number;
    error?: string;
  }> {
    try {
      // Busca todas as instâncias
      const { data: instances, error: fetchError } = await supabaseServiceRole
        .from('evolution_instances')
        .select('id, sent_today, error_today, rate_limit_count_today');

      if (fetchError) {
        console.error('Erro ao buscar instâncias para reset:', fetchError);
        return {
          success: false,
          resetCount: 0,
          error: fetchError.message,
        };
      }

      if (!instances || instances.length === 0) {
        return {
          success: true,
          resetCount: 0,
        };
      }

      // Reseta contadores de todas as instâncias
      const { error: updateError } = await supabaseServiceRole
        .from('evolution_instances')
        .update({
          sent_today: 0,
          error_today: 0,
          rate_limit_count_today: 0,
          updated_at: new Date().toISOString(),
        })
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Atualiza todas (trick para atualizar todas as linhas)

      if (updateError) {
        console.error('Erro ao resetar contadores:', updateError);
        return {
          success: false,
          resetCount: 0,
          error: updateError.message,
        };
      }

      console.log(`✅ Reset diário concluído. ${instances.length} instâncias resetadas.`);

      return {
        success: true,
        resetCount: instances.length,
      };
    } catch (error: any) {
      console.error('Erro ao executar reset diário:', error);
      return {
        success: false,
        resetCount: 0,
        error: error?.message || 'Erro desconhecido',
      };
    }
  }

  /**
   * Verifica se é hora de fazer o reset (00:00 no fuso de Recife)
   */
  shouldReset(): boolean {
    // Obtém hora atual no fuso de Recife/Brasil
    const now = new Date();
    const recifeTime = new Date(
      now.toLocaleString('en-US', { timeZone: 'America/Recife' })
    );

    // Verifica se é 00:00 (ou próximo de 00:00 com margem de 5 minutos)
    const hours = recifeTime.getHours();
    const minutes = recifeTime.getMinutes();

    // Reset entre 00:00 e 00:05 (margem para segurança)
    return hours === 0 && minutes < 5;
  }

  /**
   * Obtém próximo horário de reset
   */
  getNextResetTime(): Date {
    const now = new Date();
    const recifeTime = new Date(
      now.toLocaleString('en-US', { timeZone: 'America/Recife' })
    );

    // Se já passou das 00:00 hoje, próximo reset é amanhã
    if (recifeTime.getHours() >= 0 && recifeTime.getMinutes() >= 5) {
      recifeTime.setDate(recifeTime.getDate() + 1);
    }

    recifeTime.setHours(0, 0, 0, 0);
    return recifeTime;
  }
}

export const dailyResetService = new DailyResetService();

