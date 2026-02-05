/**
 * Tipos para a feature Limpeza de Lista (dedup + validação WhatsApp)
 */

export type ListCleaningJobStatus =
  | 'draft'
  | 'deduped'
  | 'verifying'
  | 'coffee_pause'
  | 'paused_disconnected'
  | 'done'
  | 'error';

export type WhatsAppItemStatus = 'active' | 'inactive' | 'unknown';

export interface ListCleaningJob {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  status: ListCleaningJobStatus;
  total_raw: number;
  total_unique: number;
  duplicates_removed: number;
  verified_count: number;
  validated_count: number;
  not_validated_count: number;
  pending_count: number;
  last_processed_index: number;
  next_run_at: string | null;
  session_name_used: string | null;
  error_message: string | null;
}

export interface ListCleaningItem {
  id: string;
  job_id: string;
  phone: string;
  is_duplicate: boolean;
  whatsapp_status: WhatsAppItemStatus | null;
  verified_at: string | null;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
}

