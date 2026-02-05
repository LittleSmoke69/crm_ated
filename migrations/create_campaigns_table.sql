-- Tabela de campanhas com suporte a mídia
CREATE TABLE IF NOT EXISTS campaigns_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  media_type TEXT CHECK (media_type IN ('image', 'video', 'audio')) NULL,
  media_bucket TEXT NULL,
  media_path TEXT NULL,
  media_mime TEXT NULL,
  media_size BIGINT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_upload', 'ready', 'error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_campaigns_media_owner_id ON campaigns_media(owner_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_media_status ON campaigns_media(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_media_created_at ON campaigns_media(created_at DESC);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_campaigns_media_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_campaigns_media_updated_at
  BEFORE UPDATE ON campaigns_media
  FOR EACH ROW
  EXECUTE FUNCTION update_campaigns_media_updated_at();

-- RLS (Row Level Security)
ALTER TABLE campaigns_media ENABLE ROW LEVEL SECURITY;

-- Policy: Service role tem acesso total (para uso no backend)
CREATE POLICY "Service role full access campaigns media"
  ON campaigns_media
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Usuários autenticados podem ver suas próprias campanhas
-- Nota: Como o sistema usa profiles e não auth.users, as policies são aplicadas no backend
-- via validação de owner_id. As policies aqui são para compatibilidade com RLS.
CREATE POLICY "Users can view own campaigns media"
  ON campaigns_media FOR SELECT
  TO authenticated
  USING (true); -- Validação de ownership feita no backend

CREATE POLICY "Users can insert own campaigns media"
  ON campaigns_media FOR INSERT
  TO authenticated
  WITH CHECK (true); -- Validação de ownership feita no backend

CREATE POLICY "Users can update own campaigns media"
  ON campaigns_media FOR UPDATE
  TO authenticated
  USING (true); -- Validação de ownership feita no backend

CREATE POLICY "Users can delete own campaigns media"
  ON campaigns_media FOR DELETE
  TO authenticated
  USING (true); -- Validação de ownership feita no backend

