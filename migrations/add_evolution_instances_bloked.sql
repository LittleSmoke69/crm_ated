-- Instância marcada como bloqueada não é usada no maturador (disparos seguem normais).

ALTER TABLE public.evolution_instances
  ADD COLUMN IF NOT EXISTS blocked_from_maturation BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.evolution_instances.blocked_from_maturation IS
  'Quando true, a instância não entra no pool do maturador (seleção automática nem manual).';
