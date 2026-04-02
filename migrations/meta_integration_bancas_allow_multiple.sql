-- Permite que a mesma banca (crm_bancas) tenha N integrações Meta (N contas de anúncio / tokens distintos).
-- Antes: UNIQUE (banca_id) em meta_integration_bancas impedia mais de um vínculo por banca.
-- A PK (integration_id, banca_id) já permite (int1, bancaA) e (int2, bancaA).

ALTER TABLE meta_integration_bancas
  DROP CONSTRAINT IF EXISTS meta_integration_bancas_banca_id_key;

COMMENT ON TABLE meta_integration_bancas IS 'Vínculo banca ↔ integração Meta: uma banca pode ter várias integrações (várias contas de anúncio).';
