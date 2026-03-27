-- Insights: custo por tipo de ação retornado pela Meta (cost_per_action_type).
ALTER TABLE meta_insights_daily
  ADD COLUMN IF NOT EXISTS raw_cost_per_action_type JSONB;

COMMENT ON COLUMN meta_insights_daily.raw_cost_per_action_type IS 'Snapshot de cost_per_action_type da Graph API Insights (action_type + value).';
