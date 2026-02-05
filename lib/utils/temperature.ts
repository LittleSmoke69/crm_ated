/**
 * Calcula a temperatura de um lead baseado nas regras de negócio
 * 
 * Regras:
 * - Cold (Frio): Lead cadastrado há 30 dias ou menos e que nunca realizou um depósito
 * - Very Cold (Muito Frio): Lead cadastrado há mais de 30 dias e que nunca realizou um depósito
 * - Active (Ativo): Lead que já realizou depósitos, possui menos de 3 depósitos no total, e o último depósito foi há 30 dias ou menos
 * - Hot (Quente): Lead que possui 3 ou mais depósitos realizados
 * - Cooling (Esfriando): Lead que já realizou depósitos, mas o último depósito foi há mais de 30 dias
 */

export type TemperatureStatus = 'cold' | 'very_cold' | 'active' | 'hot' | 'cooling';

export interface LeadTemperatureData {
  created_at: string | Date;
  total_depositos_count?: number | string | null;
  last_deposit_at?: string | Date | null;
}

/**
 * Calcula a temperatura de um lead baseado nos dados fornecidos
 */
export function calculateLeadTemperature(data: LeadTemperatureData): TemperatureStatus {
  const now = new Date();
  const createdDate = new Date(data.created_at);
  const daysSinceCreation = Math.floor((now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
  
  const totalDepositos = parseInt(String(data.total_depositos_count || 0)) || 0;
  const hasDeposits = totalDepositos > 0;
  
  // Se nunca depositou
  if (!hasDeposits) {
    if (daysSinceCreation <= 30) {
      return 'cold';
    } else {
      return 'very_cold';
    }
  }
  
  // Se já depositou, verifica o último depósito
  if (!data.last_deposit_at) {
    // Se tem depósitos mas não tem data do último depósito, considera como cooling
    return 'cooling';
  }
  
  const lastDepositDate = new Date(data.last_deposit_at);
  const daysSinceLastDeposit = Math.floor((now.getTime() - lastDepositDate.getTime()) / (1000 * 60 * 60 * 24));
  
  // Lead com 3 ou mais depósitos = Hot
  if (totalDepositos >= 3) {
    return 'hot';
  }
  
  // Lead com menos de 3 depósitos
  if (daysSinceLastDeposit <= 30) {
    // Último depósito há 30 dias ou menos = Active
    return 'active';
  } else {
    // Último depósito há mais de 30 dias = Cooling
    return 'cooling';
  }
}

/**
 * Retorna o label em português para uma temperatura
 */
export function getTemperatureLabel(temperature: TemperatureStatus | string): string {
  const labels: Record<TemperatureStatus, string> = {
    cold: 'Frio',
    very_cold: 'Muito Frio',
    active: 'Ativo',
    hot: 'Quente',
    cooling: 'Esfriando',
  };
  
  return labels[temperature as TemperatureStatus] || temperature;
}

/**
 * Retorna o emoji para uma temperatura
 */
export function getTemperatureEmoji(temperature: TemperatureStatus | string): string {
  const emojis: Record<TemperatureStatus, string> = {
    cold: '❄️',
    very_cold: '❄️',
    active: '🔥',
    hot: '🌶️',
    cooling: '🌡️',
  };
  
  return emojis[temperature as TemperatureStatus] || '❓';
}



