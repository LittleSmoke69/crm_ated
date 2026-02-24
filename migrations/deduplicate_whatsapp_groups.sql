-- =====================================================
-- Migration: Deduplicar grupos e garantir unicidade
-- Data: 2026-02-23
-- Descrição: Remove grupos duplicados (mesmo user + instance + group_id)
--            e adiciona constraint UNIQUE para evitar novos duplicados.
-- =====================================================

-- 1. Remove duplicatas, mantendo o registro com menor id por (user_id, instance_name, group_id)
DELETE FROM whatsapp_groups a
USING whatsapp_groups b
WHERE a.id > b.id
  AND COALESCE(a.user_id::text, '') = COALESCE(b.user_id::text, '')
  AND a.instance_name = b.instance_name
  AND a.group_id = b.group_id;

-- 2. Cria índice único para impedir novos duplicados
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_groups_unique_user_instance_group
  ON whatsapp_groups (COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), instance_name, group_id);

-- Alternativa: se user_id não pode ser NULL, use:
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_groups_unique_user_instance_group
--   ON whatsapp_groups (user_id, instance_name, group_id);
