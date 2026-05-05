-- Compartilhamento de instância Evolution dentro do mesmo tenant (white label).
-- Perfil convidado deve ter o mesmo cargo (profiles.status) que quem compartilha (regra de negócio na API).

CREATE TABLE IF NOT EXISTS evolution_instance_shared_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evolution_instance_id UUID NOT NULL REFERENCES evolution_instances(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  shared_by_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(evolution_instance_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_eisu_user_id ON evolution_instance_shared_users(user_id);
CREATE INDEX IF NOT EXISTS idx_eisu_instance_id ON evolution_instance_shared_users(evolution_instance_id);

COMMENT ON TABLE evolution_instance_shared_users IS 'Usuários adicionais com acesso à instância (mesmo white label, mesmo cargo que o compartilhador).';
