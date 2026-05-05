-- Overrides de tema por white label: { "light": { "primary": "#..." }, "dark": { ... } }
-- Chaves válidas definidas em lib/constants/tenant-theme-map.ts

ALTER TABLE zaploto_tenants
ADD COLUMN IF NOT EXISTS theme_colors JSONB DEFAULT NULL;

COMMENT ON COLUMN zaploto_tenants.theme_colors IS 'Overrides por modo claro/escuro (tokens fixos no código).';
