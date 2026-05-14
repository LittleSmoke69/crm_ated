-- Marca instâncias que falharam ao enviar para o grupo de maturação.
-- group_msg_blocked = true → instância não está no grupo, envio pulado.
-- Para reativar: UPDATE master_instances SET group_msg_blocked = false, group_msg_next_at = null WHERE id = '...';

ALTER TABLE master_instances
  ADD COLUMN IF NOT EXISTS group_msg_blocked BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_master_instances_group_msg_blocked
  ON master_instances(group_msg_blocked) WHERE group_msg_blocked = false;
