-- IP do visitante no redirect (hash SHA-256, mesmo padrão de vsl_sessions)
ALTER TABLE redirect_clicks
  ADD COLUMN IF NOT EXISTS ip_hash text NULL;

ALTER TABLE redirect_visits
  ADD COLUMN IF NOT EXISTS ip_hash text NULL;

CREATE INDEX IF NOT EXISTS idx_redirect_clicks_ip_hash
  ON redirect_clicks(ip_hash)
  WHERE ip_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_redirect_visits_ip_hash
  ON redirect_visits(ip_hash)
  WHERE ip_hash IS NOT NULL;

COMMENT ON COLUMN redirect_clicks.ip_hash IS 'SHA-256 do IP no momento do redirect (x-forwarded-for / x-real-ip).';
COMMENT ON COLUMN redirect_visits.ip_hash IS 'SHA-256 do IP na visita com UTM em /r/[slug].';
