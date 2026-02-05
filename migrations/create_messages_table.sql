-- =====================================================
-- Migration: Criar tabela messages
-- Data: 2026
-- Descrição: Tabela para armazenar mensagens personalizadas de cada usuário
-- =====================================================

CREATE TABLE IF NOT EXISTS messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    preview TEXT,
    category TEXT DEFAULT 'Boas vindas',
    is_favorite BOOLEAN DEFAULT FALSE,
    has_attachment BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para melhorar performance
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_is_favorite ON messages(is_favorite);
CREATE INDEX IF NOT EXISTS idx_messages_user_favorite ON messages(user_id, is_favorite);

-- Habilita RLS
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Política: Service role tem acesso total
CREATE POLICY "Service role full access messages"
  ON messages
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Política: Usuários podem ver apenas suas próprias mensagens
CREATE POLICY "Users can view own messages"
  ON messages
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Política: Usuários podem criar suas próprias mensagens
CREATE POLICY "Users can create own messages"
  ON messages
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Política: Usuários podem atualizar suas próprias mensagens
CREATE POLICY "Users can update own messages"
  ON messages
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Política: Usuários podem deletar suas próprias mensagens
CREATE POLICY "Users can delete own messages"
  ON messages
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Comentários para documentação
COMMENT ON TABLE messages IS 'Armazena mensagens personalizadas criadas por cada usuário';
COMMENT ON COLUMN messages.user_id IS 'ID do usuário (profiles.id) que criou a mensagem';
COMMENT ON COLUMN messages.title IS 'Título da mensagem';
COMMENT ON COLUMN messages.content IS 'Conteúdo completo da mensagem';
COMMENT ON COLUMN messages.preview IS 'Preview/trecho da mensagem para exibição na lista';
COMMENT ON COLUMN messages.category IS 'Categoria da mensagem (ex: Boas vindas, Promoção, etc)';
COMMENT ON COLUMN messages.is_favorite IS 'Indica se a mensagem está marcada como favorita';
COMMENT ON COLUMN messages.has_attachment IS 'Indica se a mensagem possui anexo';

