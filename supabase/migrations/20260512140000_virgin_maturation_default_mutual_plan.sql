-- Plano de maturação mútua (malha) definido pelo admin para usuários do Maturador (rede mútua).
INSERT INTO virgin_maturation_config (key, value_json, updated_at)
VALUES (
  'default_mutual_maturation_plan_id',
  '{"plan_id": null}'::jsonb,
  NOW()
)
ON CONFLICT (key) DO NOTHING;
