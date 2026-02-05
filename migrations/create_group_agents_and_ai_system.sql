-- =====================================================
-- Migration: Sistema Completo de Agente por Grupo + Dataset + Jobs + Tokens
-- Data: 2024
-- Descrição: Sistema completo para agentes IA por grupo WhatsApp, base de treinamento,
--            jobs de geração de mídia (Imagen/Veo) e tracking de tokens/custos
-- =====================================================

-- =====================================================
-- 1) CONFIG DO AGENTE POR GRUPO
-- =====================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_group_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NULL,
  group_jid text NOT NULL UNIQUE, -- 1203...@g.us

  agent_name text NOT NULL DEFAULT 'Agente IA',
  persona_tone text NOT NULL DEFAULT 'gentil' CHECK (persona_tone IN ('neutro', 'gentil', 'amigavel')),
  persona_role text NOT NULL DEFAULT 'consultor' CHECK (persona_role IN ('consultor', 'gerente')),
  objective text NOT NULL DEFAULT 'levar para deposito',

  -- anti-spam / gating
  max_replies_per_window int NOT NULL DEFAULT 2,
  window_seconds int NOT NULL DEFAULT 300,
  user_cooldown_seconds int NOT NULL DEFAULT 600,
  only_reply_if_question boolean NOT NULL DEFAULT true,
  only_reply_if_mentioned boolean NOT NULL DEFAULT false,
  keywords text[] NOT NULL DEFAULT ARRAY[
    'lotinha','lotofacil','tabela','valor','pix','deposito','cadastro','aposta','resultado','premio','quantos'
  ],

  -- mídia padrão do grupo (pode sobrescrever por flow)
  table_image_url text NULL,
  signup_video_url text NULL,
  bet_video_url text NULL,

  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Comentários
COMMENT ON TABLE public.whatsapp_group_agents IS 'Configuração de Agente IA por grupo WhatsApp - define persona, anti-spam e mídias padrão';
COMMENT ON COLUMN public.whatsapp_group_agents.store_id IS 'ID da loja (opcional, para multi-tenant futuro)';
COMMENT ON COLUMN public.whatsapp_group_agents.group_jid IS 'JID único do grupo WhatsApp (ex: 120363123456789012@g.us)';
COMMENT ON COLUMN public.whatsapp_group_agents.agent_name IS 'Nome do agente (ex: "Agente IA")';
COMMENT ON COLUMN public.whatsapp_group_agents.persona_tone IS 'Tom da persona: neutro, gentil ou amigavel';
COMMENT ON COLUMN public.whatsapp_group_agents.persona_role IS 'Papel da persona: consultor ou gerente';
COMMENT ON COLUMN public.whatsapp_group_agents.objective IS 'Objetivo principal do agente (ex: "levar para deposito")';
COMMENT ON COLUMN public.whatsapp_group_agents.max_replies_per_window IS 'Máximo de respostas por janela de tempo (anti-spam)';
COMMENT ON COLUMN public.whatsapp_group_agents.window_seconds IS 'Duração da janela de tempo em segundos (ex: 300 = 5 minutos)';
COMMENT ON COLUMN public.whatsapp_group_agents.user_cooldown_seconds IS 'Cooldown por usuário em segundos (ex: 600 = 10 minutos)';
COMMENT ON COLUMN public.whatsapp_group_agents.only_reply_if_question IS 'Se true, só responde se for claramente uma pergunta';
COMMENT ON COLUMN public.whatsapp_group_agents.only_reply_if_mentioned IS 'Se true, só responde se mencionado';
COMMENT ON COLUMN public.whatsapp_group_agents.keywords IS 'Array de palavras-chave que ativam o agente';
COMMENT ON COLUMN public.whatsapp_group_agents.table_image_url IS 'URL da imagem de tabela padrão do grupo';
COMMENT ON COLUMN public.whatsapp_group_agents.signup_video_url IS 'URL do vídeo de cadastro padrão do grupo';
COMMENT ON COLUMN public.whatsapp_group_agents.bet_video_url IS 'URL do vídeo de aposta padrão do grupo';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_whatsapp_group_agents_group ON public.whatsapp_group_agents (group_jid);
CREATE INDEX IF NOT EXISTS idx_whatsapp_group_agents_store ON public.whatsapp_group_agents (store_id) WHERE store_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_group_agents_active ON public.whatsapp_group_agents (is_active) WHERE is_active = true;

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_whatsapp_group_agents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_whatsapp_group_agents_updated_at
  BEFORE UPDATE ON public.whatsapp_group_agents
  FOR EACH ROW
  EXECUTE FUNCTION update_whatsapp_group_agents_updated_at();

-- =====================================================
-- 2) CONTEXTO "VIVO" DO GRUPO (rate limit / modo silencioso)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_group_agent_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_jid text NOT NULL UNIQUE,

  last_bot_message_at timestamptz NULL,
  last_bot_message_text text NULL,

  window_started_at timestamptz NULL,
  replies_in_window int NOT NULL DEFAULT 0,

  quiet_mode_until timestamptz NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Comentários
COMMENT ON TABLE public.whatsapp_group_agent_context IS 'Contexto "vivo" do grupo - rastreia rate limits, janelas de tempo e modo silencioso';
COMMENT ON COLUMN public.whatsapp_group_agent_context.group_jid IS 'JID único do grupo WhatsApp';
COMMENT ON COLUMN public.whatsapp_group_agent_context.last_bot_message_at IS 'Timestamp da última mensagem enviada pelo bot';
COMMENT ON COLUMN public.whatsapp_group_agent_context.last_bot_message_text IS 'Texto da última mensagem enviada pelo bot';
COMMENT ON COLUMN public.whatsapp_group_agent_context.window_started_at IS 'Timestamp de início da janela de tempo atual (para rate limiting)';
COMMENT ON COLUMN public.whatsapp_group_agent_context.replies_in_window IS 'Número de respostas na janela atual';
COMMENT ON COLUMN public.whatsapp_group_agent_context.quiet_mode_until IS 'Timestamp até quando o modo silencioso está ativo (não responde exceto mentions)';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_group_agent_context_group ON public.whatsapp_group_agent_context (group_jid);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_whatsapp_group_agent_context_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_whatsapp_group_agent_context_updated_at
  BEFORE UPDATE ON public.whatsapp_group_agent_context
  FOR EACH ROW
  EXECUTE FUNCTION update_whatsapp_group_agent_context_updated_at();

-- =====================================================
-- 3) CONTEXTO POR MEMBRO (welcome_variant + cooldown + intent)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_group_agent_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_jid text NOT NULL,
  user_phone text NOT NULL, -- 558199...

  joined_at timestamptz NULL,
  welcome_variant_id int NULL,
  welcome_text text NULL,

  last_user_message_at timestamptz NULL,
  last_user_message_text text NULL,
  last_intent text NULL,

  last_bot_reply_at timestamptz NULL,
  bot_reply_count_hour int NOT NULL DEFAULT 0,
  bot_reply_hour_started_at timestamptz NULL,

  is_blocked boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (group_jid, user_phone)
);

-- Comentários
COMMENT ON TABLE public.whatsapp_group_agent_members IS 'Contexto por membro do grupo - rastreia welcome variant, cooldown, intents e bloqueios';
COMMENT ON COLUMN public.whatsapp_group_agent_members.group_jid IS 'JID do grupo WhatsApp';
COMMENT ON COLUMN public.whatsapp_group_agent_members.user_phone IS 'Número do telefone do usuário (ex: 5581999999999)';
COMMENT ON COLUMN public.whatsapp_group_agent_members.joined_at IS 'Timestamp de quando o usuário entrou no grupo';
COMMENT ON COLUMN public.whatsapp_group_agent_members.welcome_variant_id IS 'ID da variante de boas-vindas enviada (1-10)';
COMMENT ON COLUMN public.whatsapp_group_agent_members.welcome_text IS 'Texto da mensagem de boas-vindas enviada';
COMMENT ON COLUMN public.whatsapp_group_agent_members.last_user_message_at IS 'Timestamp da última mensagem do usuário';
COMMENT ON COLUMN public.whatsapp_group_agent_members.last_user_message_text IS 'Texto da última mensagem do usuário';
COMMENT ON COLUMN public.whatsapp_group_agent_members.last_intent IS 'Último intent detectado (ex: faq_regras_lotinha, cadastro, deposito)';
COMMENT ON COLUMN public.whatsapp_group_agent_members.last_bot_reply_at IS 'Timestamp da última resposta do bot para este usuário';
COMMENT ON COLUMN public.whatsapp_group_agent_members.bot_reply_count_hour IS 'Contador de respostas do bot na hora atual';
COMMENT ON COLUMN public.whatsapp_group_agent_members.bot_reply_hour_started_at IS 'Timestamp de início da hora atual (para reset do contador)';
COMMENT ON COLUMN public.whatsapp_group_agent_members.is_blocked IS 'Se o usuário está bloqueado (não recebe mais respostas)';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_members_group ON public.whatsapp_group_agent_members (group_jid);
CREATE INDEX IF NOT EXISTS idx_members_user ON public.whatsapp_group_agent_members (user_phone);
CREATE INDEX IF NOT EXISTS idx_members_group_user ON public.whatsapp_group_agent_members (group_jid, user_phone);
CREATE INDEX IF NOT EXISTS idx_members_blocked ON public.whatsapp_group_agent_members (is_blocked) WHERE is_blocked = true;

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_whatsapp_group_agent_members_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_whatsapp_group_agent_members_updated_at
  BEFORE UPDATE ON public.whatsapp_group_agent_members
  FOR EACH ROW
  EXECUTE FUNCTION update_whatsapp_group_agent_members_updated_at();

-- =====================================================
-- 4) ASSETS (upload / gerado / vindo de grupos)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NULL,
  group_jid text NULL,

  type text NOT NULL CHECK (type IN ('image', 'video', 'audio')),
  source text NOT NULL CHECK (source IN ('upload', 'gemini_imagen', 'gemini_veo', 'evolution_group')),
  storage_bucket text NOT NULL DEFAULT 'training-assets',
  storage_path text NOT NULL,
  public_url text NULL,

  mime_type text NULL,
  duration_seconds int NULL,

  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Comentários
COMMENT ON TABLE public.media_assets IS 'Assets de mídia (imagens, vídeos, áudios) - uploads, gerados por IA ou vindos de grupos';
COMMENT ON COLUMN public.media_assets.store_id IS 'ID da loja (opcional, para multi-tenant)';
COMMENT ON COLUMN public.media_assets.group_jid IS 'JID do grupo (se o asset veio de um grupo)';
COMMENT ON COLUMN public.media_assets.type IS 'Tipo de mídia: image, video ou audio';
COMMENT ON COLUMN public.media_assets.source IS 'Origem do asset: upload, gemini_imagen, gemini_veo ou evolution_group';
COMMENT ON COLUMN public.media_assets.storage_bucket IS 'Bucket do Supabase Storage onde o asset está armazenado';
COMMENT ON COLUMN public.media_assets.storage_path IS 'Caminho do arquivo no storage (ex: store_id/group_jid/file.png)';
COMMENT ON COLUMN public.media_assets.public_url IS 'URL pública do asset (gerada pelo Supabase Storage)';
COMMENT ON COLUMN public.media_assets.mime_type IS 'Tipo MIME do arquivo (ex: image/png, video/mp4)';
COMMENT ON COLUMN public.media_assets.duration_seconds IS 'Duração em segundos (para vídeos/áudios)';
COMMENT ON COLUMN public.media_assets.created_by IS 'ID do usuário que criou/fez upload do asset';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_media_assets_store ON public.media_assets (store_id) WHERE store_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_media_assets_group ON public.media_assets (group_jid) WHERE group_jid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_media_assets_type ON public.media_assets (type);
CREATE INDEX IF NOT EXISTS idx_media_assets_source ON public.media_assets (source);
CREATE INDEX IF NOT EXISTS idx_media_assets_created_at ON public.media_assets (created_at DESC);

-- =====================================================
-- 5) DATASET (itens treináveis / consultáveis)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.training_dataset_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NULL,
  asset_id uuid NOT NULL REFERENCES public.media_assets(id) ON DELETE CASCADE,

  title text NULL,
  description text NULL,
  tags text[] NOT NULL DEFAULT '{}',
  intent text NULL, -- faq_regras_lotinha|cadastro|deposito|tabela|aposta...
  language text NOT NULL DEFAULT 'pt-BR',

  approved boolean NOT NULL DEFAULT false,
  approved_by uuid NULL,
  approved_at timestamptz NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Comentários
COMMENT ON TABLE public.training_dataset_items IS 'Itens do dataset de treinamento - mídias aprovadas que podem ser usadas pelo agente';
COMMENT ON COLUMN public.training_dataset_items.store_id IS 'ID da loja (opcional, para multi-tenant)';
COMMENT ON COLUMN public.training_dataset_items.asset_id IS 'ID do asset de mídia (referência obrigatória)';
COMMENT ON COLUMN public.training_dataset_items.title IS 'Título do item (ex: "Tabela de preços Lotinha")';
COMMENT ON COLUMN public.training_dataset_items.description IS 'Descrição do item (pode ser o prompt usado para gerar)';
COMMENT ON COLUMN public.training_dataset_items.tags IS 'Array de tags para busca e categorização';
COMMENT ON COLUMN public.training_dataset_items.intent IS 'Intent associado (ex: faq_regras_lotinha, cadastro, deposito, tabela, aposta)';
COMMENT ON COLUMN public.training_dataset_items.language IS 'Idioma do conteúdo (padrão: pt-BR)';
COMMENT ON COLUMN public.training_dataset_items.approved IS 'Se o item está aprovado para uso pelo agente (apenas approved=true é usado)';
COMMENT ON COLUMN public.training_dataset_items.approved_by IS 'ID do admin que aprovou o item';
COMMENT ON COLUMN public.training_dataset_items.approved_at IS 'Timestamp de quando o item foi aprovado';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_training_items_store ON public.training_dataset_items (store_id) WHERE store_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_training_items_asset ON public.training_dataset_items (asset_id);
CREATE INDEX IF NOT EXISTS idx_training_items_intent ON public.training_dataset_items (intent) WHERE intent IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_training_items_tags ON public.training_dataset_items USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_training_items_approved ON public.training_dataset_items (approved) WHERE approved = true;
CREATE INDEX IF NOT EXISTS idx_training_items_created_at ON public.training_dataset_items (created_at DESC);

-- =====================================================
-- 6) CAPTIONS / TRANSCRICAO / OCR (para RAG depois)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.training_captions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_item_id uuid NOT NULL REFERENCES public.training_dataset_items(id) ON DELETE CASCADE,

  caption text NULL,
  ocr_text text NULL,
  transcript text NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Comentários
COMMENT ON TABLE public.training_captions IS 'Captions, transcrições e OCR dos itens do dataset - usado para RAG (Retrieval Augmented Generation)';
COMMENT ON COLUMN public.training_captions.dataset_item_id IS 'ID do item do dataset (referência obrigatória)';
COMMENT ON COLUMN public.training_captions.caption IS 'Legenda/caption do conteúdo (gerado por IA ou manual)';
COMMENT ON COLUMN public.training_captions.ocr_text IS 'Texto extraído via OCR (para imagens)';
COMMENT ON COLUMN public.training_captions.transcript IS 'Transcrição de áudio/vídeo';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_training_captions_item ON public.training_captions (dataset_item_id);

-- =====================================================
-- 7) JOBS (especialmente vídeo)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NULL,
  group_jid text NULL,

  job_type text NOT NULL CHECK (job_type IN ('generate_image', 'generate_video', 'caption', 'transcribe')),
  provider text NOT NULL DEFAULT 'gemini',
  model text NOT NULL,

  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  operation_name text NULL, -- usado no Veo (predictLongRunning)
  input_prompt text NULL,
  input_meta jsonb NOT NULL DEFAULT '{}'::jsonb,

  output_meta jsonb NOT NULL DEFAULT '{}'::jsonb, -- urls, etc.
  error_message text NULL,

  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Comentários
COMMENT ON TABLE public.ai_jobs IS 'Jobs de geração de mídia via IA (especialmente vídeo com Veo que é long-running)';
COMMENT ON COLUMN public.ai_jobs.store_id IS 'ID da loja (opcional, para multi-tenant)';
COMMENT ON COLUMN public.ai_jobs.group_jid IS 'JID do grupo (se o job foi disparado por um grupo)';
COMMENT ON COLUMN public.ai_jobs.job_type IS 'Tipo de job: generate_image, generate_video, caption ou transcribe';
COMMENT ON COLUMN public.ai_jobs.provider IS 'Provedor de IA (padrão: gemini)';
COMMENT ON COLUMN public.ai_jobs.model IS 'Modelo usado (ex: imagen-4.0-generate-001, veo-3.1-generate-preview)';
COMMENT ON COLUMN public.ai_jobs.status IS 'Status do job: queued, running, succeeded ou failed';
COMMENT ON COLUMN public.ai_jobs.operation_name IS 'Nome da operação (usado no Veo para polling via predictLongRunning)';
COMMENT ON COLUMN public.ai_jobs.input_prompt IS 'Prompt usado para gerar o conteúdo';
COMMENT ON COLUMN public.ai_jobs.input_meta IS 'Metadados de entrada (ex: aspectRatio, resolution)';
COMMENT ON COLUMN public.ai_jobs.output_meta IS 'Metadados de saída (ex: video_url, asset_id, dataset_item_id)';
COMMENT ON COLUMN public.ai_jobs.error_message IS 'Mensagem de erro (se status = failed)';
COMMENT ON COLUMN public.ai_jobs.created_by IS 'ID do usuário que criou o job';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_jobs_store ON public.ai_jobs (store_id) WHERE store_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_jobs_group ON public.ai_jobs (group_jid) WHERE group_jid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON public.ai_jobs (status);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_type ON public.ai_jobs (job_type);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_created_at ON public.ai_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_operation_name ON public.ai_jobs (operation_name) WHERE operation_name IS NOT NULL;

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_ai_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_ai_jobs_updated_at
  BEFORE UPDATE ON public.ai_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_jobs_updated_at();

-- =====================================================
-- 8) LOG DE USO (tokens / custos / auditoria)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NULL,
  group_jid text NULL,

  job_id uuid NULL REFERENCES public.ai_jobs(id) ON DELETE SET NULL,

  provider text NOT NULL DEFAULT 'gemini',
  model text NOT NULL,
  endpoint text NOT NULL, -- generateContent|imagen:predict|veo:predictLongRunning|countTokens

  prompt_tokens int NULL,
  output_tokens int NULL,
  total_tokens int NULL,
  modality_breakdown jsonb NULL, -- se você quiser guardar detalhes por modalidade

  estimated_cost_usd numeric NULL,

  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Comentários
COMMENT ON TABLE public.ai_usage_logs IS 'Log de uso de IA - rastreia tokens, custos e auditoria de todas as chamadas';
COMMENT ON COLUMN public.ai_usage_logs.store_id IS 'ID da loja (opcional, para multi-tenant)';
COMMENT ON COLUMN public.ai_usage_logs.group_jid IS 'JID do grupo (se a chamada foi disparada por um grupo)';
COMMENT ON COLUMN public.ai_usage_logs.job_id IS 'ID do job relacionado (se aplicável)';
COMMENT ON COLUMN public.ai_usage_logs.provider IS 'Provedor de IA (padrão: gemini)';
COMMENT ON COLUMN public.ai_usage_logs.model IS 'Modelo usado (ex: imagen-4.0-generate-001, veo-3.1-generate-preview, gemini-2.0-flash)';
COMMENT ON COLUMN public.ai_usage_logs.endpoint IS 'Endpoint chamado (ex: generateContent, imagen:predict, veo:predictLongRunning, countTokens)';
COMMENT ON COLUMN public.ai_usage_logs.prompt_tokens IS 'Número de tokens do prompt';
COMMENT ON COLUMN public.ai_usage_logs.output_tokens IS 'Número de tokens da saída';
COMMENT ON COLUMN public.ai_usage_logs.total_tokens IS 'Total de tokens (prompt + output)';
COMMENT ON COLUMN public.ai_usage_logs.modality_breakdown IS 'Breakdown por modalidade (ex: text, image, video) em formato JSON';
COMMENT ON COLUMN public.ai_usage_logs.estimated_cost_usd IS 'Custo estimado em USD (calculado baseado em pricing do modelo)';
COMMENT ON COLUMN public.ai_usage_logs.created_by IS 'ID do usuário que disparou a chamada';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_usage_store ON public.ai_usage_logs (store_id) WHERE store_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_usage_group ON public.ai_usage_logs (group_jid) WHERE group_jid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_usage_job ON public.ai_usage_logs (job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON public.ai_usage_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_model ON public.ai_usage_logs (model);
CREATE INDEX IF NOT EXISTS idx_ai_usage_endpoint ON public.ai_usage_logs (endpoint);
CREATE INDEX IF NOT EXISTS idx_ai_usage_provider ON public.ai_usage_logs (provider);

-- =====================================================
-- 9) VIEW: Consumo diário (Admin → consumo por dia)
-- =====================================================

CREATE OR REPLACE VIEW public.ai_usage_daily AS
SELECT
  store_id,
  date_trunc('day', created_at) AS day,
  COALESCE(SUM(total_tokens), 0) AS total_tokens,
  COALESCE(SUM(estimated_cost_usd), 0) AS total_cost_usd,
  COUNT(*) AS requests,
  provider,
  model
FROM public.ai_usage_logs
GROUP BY store_id, date_trunc('day', created_at), provider, model
ORDER BY day DESC, store_id, provider, model;

-- Comentários
COMMENT ON VIEW public.ai_usage_daily IS 'View agregada de consumo diário de IA - tokens e custos por dia, store, provider e modelo';

-- =====================================================
-- Validação: Verifica se as tabelas foram criadas
-- =====================================================
-- SELECT table_name 
-- FROM information_schema.tables 
-- WHERE table_schema = 'public' 
-- AND table_name IN (
--   'whatsapp_group_agents',
--   'whatsapp_group_agent_context',
--   'whatsapp_group_agent_members',
--   'media_assets',
--   'training_dataset_items',
--   'training_captions',
--   'ai_jobs',
--   'ai_usage_logs'
-- );

