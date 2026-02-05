-- Cria tabela para armazenar agendamentos de mensagens
CREATE TABLE IF NOT EXISTS message_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL,
  instance_name TEXT NOT NULL,
  
  -- Tipo de agendamento
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('once', 'recurring')),
  
  -- Para agendamento pontual
  scheduled_at_utc TIMESTAMPTZ,
  
  -- Para agendamento recorrente
  cron_expr TEXT,
  timezone TEXT DEFAULT 'America/Recife',
  recurring_days TEXT[], -- Array de dias da semana: ['monday', 'tuesday', ...]
  recurring_time TIME, -- Hora no formato HH:MM
  
  -- Próxima execução (calculada)
  next_run_utc TIMESTAMPTZ NOT NULL,
  
  -- Status e controle
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'processing', 'sent', 'failed', 'canceled', 'paused')),
  locked_at TIMESTAMPTZ,
  locked_by TEXT, -- Worker ID que travou o job
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_message_schedules_status ON message_schedules(status);
CREATE INDEX IF NOT EXISTS idx_message_schedules_next_run ON message_schedules(next_run_utc);
CREATE INDEX IF NOT EXISTS idx_message_schedules_user ON message_schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_message_schedules_message ON message_schedules(message_id);
CREATE INDEX IF NOT EXISTS idx_message_schedules_locked ON message_schedules(locked_at) WHERE locked_at IS NOT NULL;

-- Índice composto para buscar jobs devidos (usado pelo worker)
CREATE INDEX IF NOT EXISTS idx_message_schedules_due ON message_schedules(status, next_run_utc) 
  WHERE status = 'scheduled' AND next_run_utc IS NOT NULL;

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_message_schedules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_message_schedules_updated_at
  BEFORE UPDATE ON message_schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_message_schedules_updated_at();

-- RLS (Row Level Security)
ALTER TABLE message_schedules ENABLE ROW LEVEL SECURITY;

-- Política: usuários podem ver apenas seus próprios agendamentos
CREATE POLICY "Users can view their own message schedules"
  ON message_schedules
  FOR SELECT
  USING (auth.uid() = user_id);

-- Política: usuários podem criar seus próprios agendamentos
CREATE POLICY "Users can create their own message schedules"
  ON message_schedules
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Política: usuários podem atualizar seus próprios agendamentos
CREATE POLICY "Users can update their own message schedules"
  ON message_schedules
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Política: usuários podem deletar seus próprios agendamentos
CREATE POLICY "Users can delete their own message schedules"
  ON message_schedules
  FOR DELETE
  USING (auth.uid() = user_id);

-- Comentários
COMMENT ON TABLE message_schedules IS 'Armazena agendamentos de mensagens para envio pontual ou recorrente';
COMMENT ON COLUMN message_schedules.schedule_type IS 'Tipo de agendamento: once (pontual) ou recurring (recorrente)';
COMMENT ON COLUMN message_schedules.scheduled_at_utc IS 'Data/hora UTC para agendamento pontual';
COMMENT ON COLUMN message_schedules.cron_expr IS 'Expressão cron para agendamento recorrente';
COMMENT ON COLUMN message_schedules.next_run_utc IS 'Próxima execução calculada (usado pelo worker)';
COMMENT ON COLUMN message_schedules.locked_at IS 'Timestamp do lock (para evitar processamento duplicado)';
COMMENT ON COLUMN message_schedules.locked_by IS 'ID do worker que travou o job';

