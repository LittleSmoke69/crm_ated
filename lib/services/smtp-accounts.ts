/**
 * Helpers compartilhados das rotas admin de contas SMTP (smtp_accounts).
 * A senha nunca sai do servidor: as rotas selecionam apenas PUBLIC_COLUMNS.
 */
import { accountSentToday } from '@/lib/services/mailer';

/** Campos expostos ao admin — nunca inclui a senha. */
export const SMTP_PUBLIC_COLUMNS =
  'id, name, host, port, username, from_name, from_email, daily_limit, is_active, sent_today, sent_date, last_error, last_used_at, created_at';

export interface PublicSmtpAccount {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  from_name: string | null;
  from_email: string;
  daily_limit: number;
  is_active: boolean;
  sent_today: number;
  sent_date: string | null;
  last_error: string | null;
  last_used_at: string | null;
  created_at: string;
  used_today: number;
}

export function toPublicSmtpAccount(row: any): PublicSmtpAccount {
  return { ...row, used_today: accountSentToday(row) };
}
