-- Corrige constraint de tipo dos maturation_steps para incluir 'image' e 'audio'
-- O constraint original só permitia 'text' e 'video', mas o processor já suporta image/audio

ALTER TABLE maturation_steps
  DROP CONSTRAINT IF EXISTS maturation_steps_type_check;

ALTER TABLE maturation_steps
  ADD CONSTRAINT maturation_steps_type_check
    CHECK (type IN ('text', 'video', 'image', 'audio'));
