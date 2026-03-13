-- =====================================================
-- Etiquetas de conversas do chat (criadas por admin/super_admin para o suporte)
-- Depende: add_zaploto_id_to_profiles_and_tables ou estrutura com zaploto_id
-- =====================================================

CREATE TABLE IF NOT EXISTS chat_conversation_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zaploto_id UUID,
    name TEXT NOT NULL,
    color TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unicidade: mesmo nome (case-insensitive) por tenant; tags globais (zaploto_id NULL) por nome
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conversation_tags_unique_name
    ON chat_conversation_tags (COALESCE(zaploto_id, '00000000-0000-0000-0000-000000000000'::uuid), LOWER(TRIM(name)));

COMMENT ON TABLE chat_conversation_tags IS 'Etiquetas disponíveis para marcar conversas do chat. Criadas por admin/super_admin; usadas pelo suporte para filtrar e classificar.';
COMMENT ON COLUMN chat_conversation_tags.zaploto_id IS 'Tenant (opcional). NULL = tags globais (super_admin).';
COMMENT ON COLUMN chat_conversation_tags.name IS 'Nome da etiqueta (ex: Urgente, Reclamação).';
COMMENT ON COLUMN chat_conversation_tags.color IS 'Cor em hex (opcional) para exibição.';
COMMENT ON COLUMN chat_conversation_tags.sort_order IS 'Ordem de exibição na lista.';

CREATE INDEX IF NOT EXISTS idx_chat_conversation_tags_zaploto
    ON chat_conversation_tags (zaploto_id)
    WHERE zaploto_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_conversation_tags_zaploto_null
    ON chat_conversation_tags ((1))
    WHERE zaploto_id IS NULL;
