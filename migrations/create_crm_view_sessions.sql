-- =====================================================
-- Migration: Criar tabela crm_view_sessions
-- Data: 2026-02-06
-- Descrição: Rastreia quando gerentes/donos visualizam o CRM de consultores,
--            para que o consultor saiba que seu CRM está sendo acessado.
-- =====================================================

CREATE TABLE IF NOT EXISTS crm_view_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultant_id UUID NOT NULL,
    viewer_id UUID NOT NULL,
    viewer_name TEXT,
    last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(consultant_id, viewer_id)
);

-- Índices para buscas eficientes
CREATE INDEX IF NOT EXISTS idx_crm_view_sessions_consultant ON crm_view_sessions(consultant_id);
CREATE INDEX IF NOT EXISTS idx_crm_view_sessions_heartbeat ON crm_view_sessions(last_heartbeat);

-- RLS desabilitado pois as operações são feitas via service role (APIs autenticadas)
-- A validação de permissões é feita nas rotas da API.

COMMENT ON TABLE crm_view_sessions IS 'Sessões de visualização: quando gerente/dono acessa o CRM de um consultor';
COMMENT ON COLUMN crm_view_sessions.consultant_id IS 'ID do consultor cujo CRM está sendo visualizado';
COMMENT ON COLUMN crm_view_sessions.viewer_id IS 'ID do gerente/dono que está visualizando';
COMMENT ON COLUMN crm_view_sessions.last_heartbeat IS 'Último heartbeat; sessões > 2 min sem heartbeat são consideradas inativas';
