-- =====================================================
-- WhatsApp Cloud API (Oficial) - Configuração e eventos
-- Multi-tenant: zaploto_id (padrão Zaploto)
-- =====================================================

-- 1. Tabela de configuração do WhatsApp Oficial
CREATE TABLE IF NOT EXISTS public.whatsapp_official_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zaploto_id UUID REFERENCES zaploto_tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'WhatsApp Oficial',
    is_active BOOLEAN DEFAULT true,
    phone_number_id TEXT NOT NULL,
    waba_id TEXT NOT NULL,
    graph_version TEXT NOT NULL DEFAULT 'v25.0',
    access_token TEXT NOT NULL,
    verify_token TEXT NOT NULL,
    webhook_secret TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_official_configs_zaploto ON public.whatsapp_official_configs(zaploto_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_official_configs_active ON public.whatsapp_official_configs(is_active) WHERE is_active = true;

COMMENT ON TABLE public.whatsapp_official_configs IS 'Configurações da WhatsApp Cloud API por tenant; credenciais nunca devem ser logadas';

-- 2. Tabela genérica de eventos de webhook (canal whatsapp_official)
CREATE TABLE IF NOT EXISTS public.webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL DEFAULT 'whatsapp_official',
    event_name TEXT NOT NULL DEFAULT 'whatsapp_official',
    raw_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_source ON public.webhook_events(source);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON public.webhook_events(created_at DESC);

-- 3. RLS: apenas admin/super_admin podem gerenciar configs
ALTER TABLE public.whatsapp_official_configs ENABLE ROW LEVEL SECURITY;

-- Política: somente perfis admin ou super_admin podem SELECT
CREATE POLICY whatsapp_official_configs_select_admin ON public.whatsapp_official_configs
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid()
            AND p.status IN ('super_admin', 'admin')
        )
    );

-- Política: somente admin/super_admin podem INSERT
CREATE POLICY whatsapp_official_configs_insert_admin ON public.whatsapp_official_configs
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid()
            AND p.status IN ('super_admin', 'admin')
        )
    );

-- Política: somente admin/super_admin podem UPDATE
CREATE POLICY whatsapp_official_configs_update_admin ON public.whatsapp_official_configs
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid()
            AND p.status IN ('super_admin', 'admin')
        )
    );

-- Política: somente admin/super_admin podem DELETE
CREATE POLICY whatsapp_official_configs_delete_admin ON public.whatsapp_official_configs
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid()
            AND p.status IN ('super_admin', 'admin')
        )
    );

-- Service role ignora RLS; APIs do Zaploto usam supabaseServiceRole, então leitura/escrita continuam funcionando.
-- Para acesso via Supabase client com auth.uid(), as políticas acima garantem restrição.

-- 4. Trigger updated_at
CREATE OR REPLACE FUNCTION set_whatsapp_official_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS whatsapp_official_configs_updated_at ON public.whatsapp_official_configs;
CREATE TRIGGER whatsapp_official_configs_updated_at
    BEFORE UPDATE ON public.whatsapp_official_configs
    FOR EACH ROW EXECUTE PROCEDURE set_whatsapp_official_configs_updated_at();
