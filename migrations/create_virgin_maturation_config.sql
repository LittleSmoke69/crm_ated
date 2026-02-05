-- Configuração global da auto maturação virgem (mensagens enviadas no warmup)
CREATE TABLE IF NOT EXISTS virgin_maturation_config (
  key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE virgin_maturation_config IS 'Configuração da auto maturação virgem (ex: lista de mensagens para warmup 1:1)';

-- Mensagens padrão (array de strings)
INSERT INTO virgin_maturation_config (key, value_json, updated_at)
VALUES (
  'messages',
  '["Oi!", "Tudo bem?", "Beleza", "Ok", "👍", "Legal", "Combina", "Até mais"]'::jsonb,
  NOW()
)
ON CONFLICT (key) DO NOTHING;
