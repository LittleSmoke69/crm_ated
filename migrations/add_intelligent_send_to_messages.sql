-- =====================================================
-- Migration: Adicionar campos para Envio Inteligente (treinamento LLM) em messages
-- Data: 2026
-- Descrição: Persiste a opção de envio inteligente e referencia ids do store de treinamento
-- =====================================================

ALTER TABLE messages
ADD COLUMN IF NOT EXISTS send_intelligent BOOLEAN DEFAULT FALSE;

ALTER TABLE messages
ADD COLUMN IF NOT EXISTS training_asset_id UUID NULL;

ALTER TABLE messages
ADD COLUMN IF NOT EXISTS training_dataset_item_id UUID NULL;

COMMENT ON COLUMN messages.send_intelligent IS 'Se true, armazena (quando aplicável) a mídia no store de treinamento da LLM';
COMMENT ON COLUMN messages.training_asset_id IS 'ID do asset criado em media_assets (bucket training-assets) quando envio inteligente é usado';
COMMENT ON COLUMN messages.training_dataset_item_id IS 'ID do item criado em training_dataset_items quando envio inteligente é usado';


