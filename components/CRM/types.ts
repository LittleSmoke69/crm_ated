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
  total_apostado_loteria?: number;
  total_apostado_bichao?: number;
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
  available_withdraw?: number;
  bonus?: number;
  convert?: number;
  total_afiliate?: number;
  aposta_estrelas?: number;
  /** Banca em que o lead está cadastrado (preenchido quando há múltiplas bancas ou filtro "Todas as Bancas") */
  banca_id?: string;
  banca_name?: string;
  /** URL da banca em que o lead está cadastrado; usar para histórico depósito/saque/aposta. */
  banca_url?: string;
  /** Id numérico do lead na API externa (ex.: 28660). Usar como user_id ao salvar feedback. */
  original_id?: number | string;
  /** Id numérico do consultor na API externa (ex.: 21206). Usar em spin-transfer e send-spins. */
  consultant_id?: number | null;
  /** Campos de lead transferido (página Transferido) */
  tag_de_redistribuicao?: string | null;
  transferred?: boolean;
  transferred_at?: string | null;
  original_consultant_id?: number | null;
  original_consultant_name?: string | null;
  original_consultant_email?: string | null;
  /** Lead resolvido como "vinculado" após prazo (consultor converteu); exibir "Lead na carteira" no card */
  vinculado?: boolean;
  /** Prazo em dias definido na transferência (admin_lead_transfer_logs.deadline_days). Sobrescreve a prop de coluna no LeadCard. */
  transfer_deadline_days?: number | null;
}

export interface Column {
  id: string;
  title: string;
  color: string;
  leads: Lead[];
  totalLeads?: number; // Total de leads disponíveis (para paginação)
}
