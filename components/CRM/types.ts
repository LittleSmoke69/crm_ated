export type ThermalStatus = 'cold' | 'very_cold' | 'active' | 'hot' | 'cooling';

export interface Tag {
  id: string;
  label: string;
  color: string;
}

export interface Lead {
  id: string | number;
  name: string;
  last_name?: string;
  phone: string;
  email: string;
  origin?: string;
  thermalStatus: ThermalStatus;
  createdAt: string;
  tags: Tag[];
  interactions: number;
  lastInteractionAt: string;
  isFavorite: boolean;
  status: 
    | 'novo' 
    | 'sem_deposito' 
    | 'contato'
    | 'deposito_sem_jogo' 
    | 'deposito_1x' 
    | 'deposito'
    | 'aposta_1x' 
    | 'aposta'
    | 'ativo' 
    | 'deposito_sem_aposta' 
    | 'deposito_2x' 
    | 'deposito_3x' 
    | 'inativo';
  alertStatus?: 'idle' | 'contacting' | 'failed';
  total_depositado?: number;
  total_apostado?: number;
  total_ganho?: number;
  total_depositos_count?: number;
  stars?: number;
  is_affiliate?: boolean;
  affiliate_name?: string | null;
  temperature?: string;
  last_interaction?: string;
  has_interaction?: boolean;
  last_deposit_at?: string;
  last_deposit_value?: number;
  created_at?: string;
  last_winner_value?: number;
  last_winner_at?: string | null;
  last_withdraw_at?: string | null;
  last_withdraw_value?: number;
  total_saque?: number;
  balance?: number;
  bonus?: number;
  convert?: number;
  total_afiliate?: number;
  aposta_estrelas?: number;
}

export interface Column {
  id: string;
  title: string;
  color: string;
  leads: Lead[];
  totalLeads?: number; // Total de leads disponíveis (para paginação)
}

