-- Adiciona coluna horario (horário de atendimento) à tabela de contatos (searches)
-- Usado pelo chat para registrar o melhor horário para contatar o cliente

ALTER TABLE searches ADD COLUMN IF NOT EXISTS horario TEXT;

COMMENT ON COLUMN searches.horario IS 'Horário de atendimento/preferência do contato (ex: "Manhã (08h–12h)", "Tarde (12h–18h)")';
