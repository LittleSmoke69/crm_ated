-- Overrides de tema por white label: { "light": { "primary": "#..." }, "dark": { ... } }
-- Chaves válidas em lib/constants/tenant-theme-map.ts
-- Corrige: PostgREST "Could not find the 'theme_colors' column ... in the schema cache"

ALTER TABLE zaploto_tenants
ADD COLUMN IF NOT EXISTS theme_colors JSONB DEFAULT NULL;

COMMENT ON COLUMN zaploto_tenants.theme_colors IS 'Overrides por modo claro/escuro (tokens fixos no código).';
