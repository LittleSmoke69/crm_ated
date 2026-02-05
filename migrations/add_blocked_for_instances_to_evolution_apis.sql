-- =====================================================
-- Migration: Adicionar campo is_blocked_for_instances em evolution_apis
-- Data: 2026
-- Descrição: Permite bloquear uma API Evolution para criação de instâncias, mas ainda permite uso para adicionar pessoas em grupos e enviar mensagens
-- =====================================================

ALTER TABLE evolution_apis
ADD COLUMN IF NOT EXISTS is_blocked_for_instances BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN evolution_apis.is_blocked_for_instances IS 'Se true, a API não será usada no balanceamento para criação de novas instâncias, mas ainda pode ser usada para adicionar pessoas em grupos e enviar mensagens';

