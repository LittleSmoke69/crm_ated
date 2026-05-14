-- Controle de mensagens automáticas no grupo de maturação por instância.
-- group_msg_next_at:      próximo envio agendado (null = enviar no próximo tick)
-- group_msg_strophe_idx:  índice da próxima estrofe da música a enviar (cicla ao terminar)

ALTER TABLE master_instances
  ADD COLUMN IF NOT EXISTS group_msg_next_at    TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS group_msg_strophe_idx INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_master_instances_group_msg_next_at
  ON master_instances(group_msg_next_at);
