// Tipos compartilhados entre frontend e backend

export interface Contact {
  id: string;
  name?: string;
  telefone: string | null;
  status_disparo?: boolean;
  status_add_gp?: boolean;
  status?: string;
  block_list?: boolean; // Indica se o contato está em alguma lista (true = bloqueado, false = disponível)
}

export interface WhatsAppInstance {
  id?: string;
  instance_name: string;
  status: string; // 'connecting' | 'connected' | 'disconnected' | 'unknown'
  hash?: string;
  number?: string;
  qr_code?: string | null;
  connected_at?: string | null;
  user_id?: string;
}

export interface EvolutionGroup {
  id: string;
  subject: string;
  pictureUrl?: string;
  size?: number;
}

export interface DbGroup {
  group_id: string;
  group_subject: string;
}

export interface Campaign {
  id: string;
  user_id: string;
  group_id: string;
  group_subject: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  total_contacts: number;
  processed_contacts: number;
  failed_contacts: number;
  strategy: Record<string, any>;
  instances: string[];
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export type DelayUnit = 'seconds' | 'minutes';
export type DistributionMode = 'sequential' | 'random';

export interface DelayConfig {
  delayMode: 'random' | 'fixed';
  delayUnit: DelayUnit;
  delayValue: number;
  randomMinSeconds: number;
  randomMaxSeconds: number;
}

export interface CampaignStrategy {
  delayConfig: DelayConfig;
  randomTimer: boolean; // Indica se o random timer está ativo
  distributionMode: DistributionMode;
  concurrency: number;
  multiInstancesMode: boolean;
  instances: string[];
}

