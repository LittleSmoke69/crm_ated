-- Espelho de supabase/migrations/20260515120000_chat_broadcasts_step_claim.sql
ALTER TABLE public.chat_broadcasts
  ADD COLUMN IF NOT EXISTS step_claim_token uuid NULL,
  ADD COLUMN IF NOT EXISTS step_claim_at timestamptz NULL;
