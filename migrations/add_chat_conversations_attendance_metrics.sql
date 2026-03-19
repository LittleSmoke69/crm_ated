-- =====================================================
-- Metrificação de atendimento do chat
-- Status (pendente/resolvido), etiquetas, tempo de atendimento.
-- Depende: add_chat_conversations_window_24h.sql, add_whatsapp_official_chat_support.sql
-- =====================================================

-- Status da conversa: pendente (em atendimento) ou resolvido (fechada, vai para histórico)
-- NULL = tratado como pendente na aplicação (conversas antigas)
ALTER TABLE chat_conversations
    ADD COLUMN IF NOT EXISTS attendance_status TEXT
    DEFAULT 'pendente'
    CHECK (attendance_status IS NULL OR attendance_status IN ('pendente', 'resolvido'));

COMMENT ON COLUMN chat_conversations.attendance_status IS
    'pendente = em atendimento / nova 24h; resolvido = fechada, aparece no histórico.';

-- Quando foi marcada como resolvida (para métrica de tempo até resolução)
ALTER TABLE chat_conversations
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

COMMENT ON COLUMN chat_conversations.resolved_at IS
    'Preenchido quando a conversa é marcada como resolvida. Usado em relatórios de atendimento.';

-- Quando foi atribuída ao atendente (para tempo de uso no chat)
ALTER TABLE chat_conversations
    ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

COMMENT ON COLUMN chat_conversations.assigned_at IS
    'Quando a conversa foi atribuída ao user_id. Tempo de atendimento = resolved_at - assigned_at.';

-- Etiquetas livres (ex: urgente, reclamação, dúvida)
ALTER TABLE chat_conversations
    ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

COMMENT ON COLUMN chat_conversations.tags IS
    'Etiquetas para metrificação e filtros (ex: urgente, reclamação, dúvida).';

-- Índices para relatórios e filtros
CREATE INDEX IF NOT EXISTS idx_chat_conversations_attendance_status
    ON chat_conversations (attendance_status)
    WHERE attendance_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_conversations_resolved_at
    ON chat_conversations (resolved_at DESC)
    WHERE resolved_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_conversations_user_resolved
    ON chat_conversations (user_id, resolved_at DESC)
    WHERE user_id IS NOT NULL AND resolved_at IS NOT NULL;

-- Suporte a busca por tag (GIN para array)
CREATE INDEX IF NOT EXISTS idx_chat_conversations_tags
    ON chat_conversations USING GIN (tags)
    WHERE tags IS NOT NULL AND array_length(tags, 1) > 0;
