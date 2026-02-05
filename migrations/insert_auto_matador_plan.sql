-- Plano fixo "Mensagens do Auto maturador" para jobs que usam mensagens do virgin_maturation_config.
-- O maturation-start usa este plan_id quando use_virgin_messages = true e monta os steps em runtime.
-- UUID fixo para referência no código: PLAN_ID_VIRGIN_MESSAGES = 'a0000000-0000-0000-0000-000000000001'

INSERT INTO maturation_plans (id, name, description, is_active, steps_json, default_target_chat_id, created_at, updated_at)
VALUES (
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'Mensagens do Auto maturador',
  'Usa as mensagens configuradas no Auto maturador (texto, vídeo, imagem, áudio). Os steps são gerados em tempo de execução a partir de virgin_maturation_config.',
  true,
  '[]'::jsonb,
  NULL,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- Permitir tipos image e audio em maturation_steps (além de text e video)
ALTER TABLE maturation_steps DROP CONSTRAINT IF EXISTS maturation_steps_type_check;
ALTER TABLE maturation_steps ADD CONSTRAINT maturation_steps_type_check
  CHECK (type IN ('text', 'video', 'image', 'audio'));

-- Permitir tipos image e audio em maturation_messages (feed)
ALTER TABLE maturation_messages DROP CONSTRAINT IF EXISTS maturation_messages_type_check;
ALTER TABLE maturation_messages ADD CONSTRAINT maturation_messages_type_check
  CHECK (type IN ('text', 'video', 'image', 'audio', 'info', 'error', 'retry'));
