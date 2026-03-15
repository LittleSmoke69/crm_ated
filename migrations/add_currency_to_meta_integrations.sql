-- Migration: Adiciona coluna currency à meta_integrations
-- Data: 2026-03-15
-- Descrição: Armazena a moeda da conta de anúncios Meta (USD, BRL, etc.)
--            para exibir o símbolo correto no dashboard

ALTER TABLE meta_integrations
  ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'BRL';

COMMENT ON COLUMN meta_integrations.currency IS 'Moeda da conta de anúncios Meta (ex: BRL, USD). Atualizada automaticamente no sync.';
