-- disable-transaction
-- Performance indexes for Zaploto
-- Addresses slow queries identified in maturation processor, evolution balancer, and chat service.

-- maturation_steps: claim_maturation_steps RPC scans by status + scheduled_at
CREATE INDEX IF NOT EXISTS idx_maturation_steps_status_scheduled
  ON maturation_steps (status, scheduled_at)
  WHERE status = 'pending';

-- maturation_steps: per-job progress counts (updateJobProgress uses 4 count queries by job_id+status)
CREATE INDEX IF NOT EXISTS idx_maturation_steps_job_status
  ON maturation_steps (job_id, status);

-- maturation_steps: stuck-step recovery scans by status + locked_at
CREATE INDEX IF NOT EXISTS idx_maturation_steps_processing_locked_at
  ON maturation_steps (locked_at)
  WHERE status = 'processing';

-- maturation_jobs: frequent lookups by status (running jobs, job progress checks)
CREATE INDEX IF NOT EXISTS idx_maturation_jobs_status
  ON maturation_jobs (status);

-- maturation_jobs: campaign sibling lookups (terminateMaturationJobsInfrastructureFailure)
CREATE INDEX IF NOT EXISTS idx_maturation_jobs_campaign_status
  ON maturation_jobs (campaign_id, status)
  WHERE campaign_id IS NOT NULL;

-- maturation_jobs: warmup-phase job lookups (ensureVirginWarmupJob)
CREATE INDEX IF NOT EXISTS idx_maturation_jobs_master_plan_created
  ON maturation_jobs (master_instance_id, plan_id, created_at);

-- evolution_instances: balancer candidate query (is_active + status + apikey filter)
CREATE INDEX IF NOT EXISTS idx_evolution_instances_active_ok
  ON evolution_instances (evolution_api_id, sent_today, last_used_at)
  WHERE is_active = true AND status = 'ok' AND apikey IS NOT NULL;

-- evolution_instances: virgin maturation processing
CREATE INDEX IF NOT EXISTS idx_evolution_instances_virgin_maturation
  ON evolution_instances (maturation_type, maturation_status, is_active, maturation_paused_at)
  WHERE maturation_type = 'virgem';

-- master_instances: per-evolution-instance lookup (ensureVirginWarmupJob)
CREATE INDEX IF NOT EXISTS idx_master_instances_evolution_instance
  ON master_instances (evolution_instance_id);

-- chat_conversations: upsert conflict resolution
CREATE INDEX IF NOT EXISTS idx_chat_conversations_conflict_key_jid
  ON chat_conversations (conflict_key, remote_jid);

-- chat_messages: upsert conflict resolution
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_msg
  ON chat_messages (conversation_id, message_id);

-- evolution_instance_logs: recent logs per instance
CREATE INDEX IF NOT EXISTS idx_evolution_instance_logs_instance_created
  ON evolution_instance_logs (evolution_instance_id, created_at DESC);
