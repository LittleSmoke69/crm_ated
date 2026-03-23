-- Expande a constraint de tipo da tabela maturation_messages para incluir 'image' e 'audio'
-- O processor já suporta steps desses tipos mas não conseguia registrar mensagens de feedback

ALTER TABLE maturation_messages
  DROP CONSTRAINT IF EXISTS maturation_messages_type_check;

ALTER TABLE maturation_messages
  ADD CONSTRAINT maturation_messages_type_check
    CHECK (type IN ('text', 'video', 'image', 'audio', 'info', 'error', 'retry'));
