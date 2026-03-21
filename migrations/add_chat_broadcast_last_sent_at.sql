-- Permite que o cron server-side respeite o delay entre envios
ALTER TABLE chat_broadcasts ADD COLUMN IF NOT EXISTS last_sent_at timestamptz;
