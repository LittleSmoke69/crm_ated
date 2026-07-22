-- =====================================================
-- Histórico de resoluções do chat (metrifica reincidência do cliente)
-- Cada linha = um ciclo "resolvido -> reaberto" (reopened_at NULL enquanto ainda resolvida)
-- Depende: create_chat_tables.sql, create_whatsapp_official_configs.sql,
--          add_chat_conversations_attendance_metrics.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS chat_conversation_resolutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    instance_id UUID REFERENCES evolution_instances(id) ON DELETE CASCADE,
    whatsapp_config_id UUID REFERENCES public.whatsapp_official_configs(id) ON DELETE CASCADE,
    workspace_id UUID,
    remote_jid TEXT NOT NULL,
    resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_by UUID REFERENCES profiles(id),
    reopened_at TIMESTAMPTZ,
    reopened_by UUID REFERENCES profiles(id),
    reopened_reason TEXT CHECK (reopened_reason IS NULL OR reopened_reason IN ('customer_reply', 'manual')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE chat_conversation_resolutions IS
    'Histórico de cada vez que uma conversa foi marcada como resolvida. reopened_at é preenchido quando o cliente responde de novo (reopened_reason=customer_reply) ou o atendente reabre manualmente (reopened_reason=manual). Usado para metrificar reincidência por cliente (remote_jid).';

CREATE INDEX IF NOT EXISTS idx_chat_conv_resolutions_conversation
    ON chat_conversation_resolutions (conversation_id, resolved_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_conv_resolutions_remote_jid
    ON chat_conversation_resolutions (remote_jid, resolved_at DESC);

-- Ciclo de resolução ainda aberto (aguardando reabertura) — no máximo um por conversa
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conv_resolutions_open
    ON chat_conversation_resolutions (conversation_id)
    WHERE reopened_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_chat_conv_resolutions_workspace
    ON chat_conversation_resolutions (workspace_id, resolved_at DESC);
