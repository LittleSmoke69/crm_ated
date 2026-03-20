-- =====================================================
-- Migration: Agente IA no Chat + Disparo em Massa
-- =====================================================

-- Associa um flow (automação) a uma instância Evolution para o chat
CREATE TABLE IF NOT EXISTS chat_instance_flows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES evolution_instances(id) ON DELETE CASCADE,
  flow_id     uuid NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_instance_flows_instance
  ON chat_instance_flows (instance_id)
  WHERE is_active = true;

-- Jobs de disparo em massa via chat (Evolution API)
CREATE TABLE IF NOT EXISTS chat_broadcasts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  instance_id     uuid NOT NULL REFERENCES evolution_instances(id) ON DELETE CASCADE,
  instance_name   text NOT NULL,
  title           text,
  -- config da mensagem a ser disparada: {type, content, attachment_url, mimetype, caption}
  message_config  jsonb NOT NULL,
  -- lista de contatos: [{phone, name}]
  contacts        jsonb NOT NULL,
  total_count     int  NOT NULL DEFAULT 0,
  current_index   int  NOT NULL DEFAULT 0,
  -- delay em segundos entre cada disparo
  delay_seconds   int  NOT NULL DEFAULT 30,
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','paused','completed','failed','cancelled')),
  started_at      timestamptz,
  completed_at    timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_broadcasts_user
  ON chat_broadcasts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_broadcasts_active
  ON chat_broadcasts (status)
  WHERE status IN ('pending','running','paused');

-- Habilita Realtime para progresso em tempo real no frontend
ALTER PUBLICATION supabase_realtime ADD TABLE chat_broadcasts;
