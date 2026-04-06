/**
 * Tipos do módulo Anti-Spam.
 */

export interface AntiSpamConfig {
  id: string;
  banca_id: string | null;
  owner_type: 'banca' | 'user';
  owner_id: string | null;
  is_enabled: boolean;
  master_instance_id: string;
  watcher_instance_id: string | null;
  denuncia_group_jid: string | null;
  scan_mode: 'all_groups' | 'selected_groups';
  /** Apaga mensagens em grupos que contenham palavras cadastradas */
  suspicious_messages_enabled?: boolean;
  master_instance_name?: string;
  watcher_instance_name?: string | null;
}

export interface AntiSpamGroup {
  id: string;
  config_id: string;
  group_jid: string;
  group_name: string | null;
  is_monitored: boolean;
}

export interface AntiSpamBlacklistEntry {
  id: string;
  config_id: string;
  phone_e164: string;
  wa_jid: string | null;
  reason: string;
  status: string;
  scope?: 'global' | 'user';
}

export interface AntiSpamActionRow {
  id: string;
  config_id: string | null;
  banca_id: string | null;
  user_id: string | null;
  event_id: string | null;
  group_jid: string | null;
  phone_e164: string | null;
  action: 'remove_from_group' | 'add_to_blacklist' | 'delete_message';
  result: 'success' | 'fail' | 'skipped';
  error_message: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}

export interface WebhookEventRow {
  id: string;
  received_at: string;
  env: string;
  event_type: string;
  instance_name: string | null;
  remote_jid: string | null;
  message_id: string | null;
  payload: Record<string, unknown>;
  payload_normalized?: Record<string, unknown> | null;
}
