-- Habilita Supabase Realtime na tabela de campanhas de disparo em massa.
-- Idempotente: se já estiver habilitado, não faz nada.
-- Execute no SQL Editor do Supabase.

ALTER PUBLICATION supabase_realtime ADD TABLE activation_mass_send_jobs;
