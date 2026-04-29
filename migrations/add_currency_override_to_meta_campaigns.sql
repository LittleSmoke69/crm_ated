-- Migration: Adiciona coluna currency_override à meta_campaigns
-- Data: 2026-04-28
-- Descrição: Permite ao admin sobrescrever manualmente a moeda da Ad Account
--            por campanha (ex.: forçar 'USD' quando a Meta ainda não retornou
--            currency, ou corrigir uma detecção errada). Quando NULL usamos a
--            moeda devolvida por getAccountFinance da Ad Account associada.
--            Aceita 'BRL' ou 'USD' (CHECK constraint para evitar valores soltos).

ALTER TABLE meta_campaigns
  ADD COLUMN IF NOT EXISTS currency_override TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.constraint_column_usage
    WHERE table_name = 'meta_campaigns'
      AND constraint_name = 'meta_campaigns_currency_override_chk'
  ) THEN
    ALTER TABLE meta_campaigns
      ADD CONSTRAINT meta_campaigns_currency_override_chk
      CHECK (currency_override IS NULL OR currency_override IN ('BRL', 'USD'));
  END IF;
END$$;

COMMENT ON COLUMN meta_campaigns.currency_override IS
  'Moeda manual escolhida no painel admin (BRL ou USD). Quando NULL, usamos a moeda nativa da Ad Account devolvida pela Meta.';
