-- =====================================================
-- Migration: Criar tabelas para webhook da Evolution API
-- Data: 2024
-- Descrição: Cria tabelas para auditoria de eventos recebidos via webhook e sistema de "waiters" para testes estilo n8n
-- =====================================================

-- =====================================================
-- Tabela: evolution_webhook_events
-- Armazena todos os eventos recebidos via webhook para auditoria
-- =====================================================

CREATE TABLE IF NOT EXISTS evolution_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz NOT NULL DEFAULT now(),
  env text NOT NULL CHECK (env IN ('prod', 'test')),
  event_type text NOT NULL,
  instance_name text,
  remote_jid text,
  message_id text,
  payload jsonb NOT NULL
);

-- Comentários nas colunas
COMMENT ON TABLE evolution_webhook_events IS 'Armazena todos os eventos recebidos via webhook da Evolution API para auditoria';
COMMENT ON COLUMN evolution_webhook_events.received_at IS 'Timestamp de quando o evento foi recebido';
COMMENT ON COLUMN evolution_webhook_events.env IS 'Ambiente do webhook: prod ou test';
COMMENT ON COLUMN evolution_webhook_events.event_type IS 'Tipo do evento (ex: MESSAGES_UPSERT, SEND_MESSAGE, etc)';
COMMENT ON COLUMN evolution_webhook_events.instance_name IS 'Nome da instância da Evolution API';
COMMENT ON COLUMN evolution_webhook_events.remote_jid IS 'JID remoto (número ou grupo)';
COMMENT ON COLUMN evolution_webhook_events.message_id IS 'ID da mensagem (se aplicável)';
COMMENT ON COLUMN evolution_webhook_events.payload IS 'Payload completo do evento em formato JSON';

-- Indexes para performance
CREATE INDEX IF NOT EXISTS idx_evolution_webhook_events_received_at 
ON evolution_webhook_events(received_at DESC);

CREATE INDEX IF NOT EXISTS idx_evolution_webhook_events_event_type 
ON evolution_webhook_events(event_type);

CREATE INDEX IF NOT EXISTS idx_evolution_webhook_events_instance_name 
ON evolution_webhook_events(instance_name);

CREATE INDEX IF NOT EXISTS idx_evolution_webhook_events_env 
ON evolution_webhook_events(env);

-- Index UNIQUE para idempotência (evita duplicação de eventos com mesmo message_id e instance)
CREATE UNIQUE INDEX IF NOT EXISTS idx_evolution_webhook_events_instance_message_unique 
ON evolution_webhook_events(instance_name, message_id) 
WHERE message_id IS NOT NULL;

-- =====================================================
-- Tabela: evolution_webhook_test_waiters
-- Sistema de "waiters" para testes estilo n8n (aguardar evento sem websocket)
-- =====================================================

CREATE TABLE IF NOT EXISTS evolution_webhook_test_waiters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'received', 'expired')),
  expires_at timestamptz NOT NULL,
  received_event_id uuid REFERENCES evolution_webhook_events(id) ON DELETE SET NULL,
  received_at timestamptz,
  env text NOT NULL DEFAULT 'test' CHECK (env IN ('test', 'prod'))
);

-- Comentários nas colunas
COMMENT ON TABLE evolution_webhook_test_waiters IS 'Sistema de "waiters" para testes estilo n8n - permite aguardar um evento via polling sem websocket';
COMMENT ON COLUMN evolution_webhook_test_waiters.status IS 'Status do waiter: waiting (aguardando), received (recebido), expired (expirado)';
COMMENT ON COLUMN evolution_webhook_test_waiters.expires_at IS 'Timestamp de expiração do waiter (ex: now() + 2 minutos)';
COMMENT ON COLUMN evolution_webhook_test_waiters.received_event_id IS 'ID do evento recebido (se status = received)';
COMMENT ON COLUMN evolution_webhook_test_waiters.received_at IS 'Timestamp de quando o evento foi recebido';
COMMENT ON COLUMN evolution_webhook_test_waiters.env IS 'Ambiente do waiter (normalmente test)';

-- Indexes para performance
CREATE INDEX IF NOT EXISTS idx_evolution_webhook_test_waiters_status 
ON evolution_webhook_test_waiters(status);

CREATE INDEX IF NOT EXISTS idx_evolution_webhook_test_waiters_expires_at 
ON evolution_webhook_test_waiters(expires_at);

-- Index para buscar waiters ativos (waiting)
-- Nota: A verificação de expiração (expires_at > now()) é feita na query, não no índice,
-- pois now() não é IMMUTABLE e não pode ser usado em índices parciais
CREATE INDEX IF NOT EXISTS idx_evolution_webhook_test_waiters_active 
ON evolution_webhook_test_waiters(status, expires_at, env) 
WHERE status = 'waiting';

-- =====================================================
-- Validação: Verifica se as tabelas foram criadas
-- =====================================================
-- SELECT table_name, column_name, data_type 
-- FROM information_schema.columns 
-- WHERE table_name IN ('evolution_webhook_events', 'evolution_webhook_test_waiters')
-- ORDER BY table_name, ordinal_position;

