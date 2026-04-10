-- =====================================================
-- Migration: Seed padrão - roles e sidebar do Zaploto original
-- Data: 2026-02-23
-- Depende: create_zaploto_tenants_and_roles.sql, add_zaploto_id_to_profiles_and_tables.sql
-- Descrição: Popula roles e itens de sidebar para o tenant 'zaploto'.
-- =====================================================

DO $$
DECLARE
  v_zaploto_id UUID;
  v_role_super UUID;
  v_role_admin UUID;
  v_role_suporte UUID;
  v_role_auditoria UUID;
  v_role_dono UUID;
  v_role_gestor UUID;
  v_role_gerente UUID;
  v_role_consultor UUID;
BEGIN
  SELECT id INTO v_zaploto_id FROM zaploto_tenants WHERE slug = 'zaploto' LIMIT 1;
  IF v_zaploto_id IS NULL THEN
    RAISE EXCEPTION 'Tenant zaploto não encontrado. Execute add_zaploto_id_to_profiles_and_tables.sql primeiro.';
  END IF;

  -- Inserir roles padrão (mapeamento do status atual)
  INSERT INTO zaploto_roles (zaploto_id, code, label, description, sort_order, can_have_enroller, landing_route, is_system)
  VALUES 
    (v_zaploto_id, 'super_admin', 'Super Admin', 'Acesso total', 0, false, '/admin', true),
    (v_zaploto_id, 'admin', 'Admin', 'Painel admin restrito', 1, false, '/admin', true),
    (v_zaploto_id, 'suporte', 'Suporte', 'Hierarquia e operação', 2, true, '/admin/hierarchy', true),
    (v_zaploto_id, 'auditoria', 'Auditoria', 'Auditoria e anti-spam', 3, true, '/admin', true),
    (v_zaploto_id, 'dono_banca', 'Dono de Banca', 'Gestão da banca', 4, true, '/dono-banca', true),
    (v_zaploto_id, 'gestor', 'Gestor de Tráfego', 'VSL e Meta Ads', 5, true, '/gestor-trafego', true),
    (v_zaploto_id, 'gerente', 'Gerente', 'Gestão de consultores', 6, true, '/gerente', true),
    (v_zaploto_id, 'consultor', 'Consultor', 'Operacional', 7, true, '/crm/kanban', true)
  ON CONFLICT (zaploto_id, code) DO NOTHING;

  -- Inserir sidebar items (mapeamento do Sidebar.tsx atual)
  INSERT INTO zaploto_sidebar_items (zaploto_id, code, label, href, icon_name, parent_code, sort_order)
  VALUES
    (v_zaploto_id, 'dashboard', 'Dashboard', '/', 'LayoutDashboard', NULL, 0),
    (v_zaploto_id, 'instances', 'Instâncias WhatsApp', '/instances', 'MessageSquare', NULL, 1),
    (v_zaploto_id, 'maturador', 'Maturador', '/maturador', 'FlaskConical', NULL, 2),
    (v_zaploto_id, 'painel_admin', 'Painel Admin', '/admin', 'Shield', NULL, 3),
    (v_zaploto_id, 'hierarquia', 'Hierarquia', '/admin/hierarchy', 'BarChart3', NULL, 4),
    (v_zaploto_id, 'integrations', 'Integrações', NULL, 'Webhook', NULL, 5),
    (v_zaploto_id, 'webhooks_evolution', 'Webhooks Evolution', '/admin/webhooks/evolution', 'Webhook', 'integrations', 0),
    (v_zaploto_id, 'webhooks_rules', 'Regras Normalização', '/admin/webhooks/normalization-rules', 'Settings', 'integrations', 1),
    (v_zaploto_id, 'meta_ads', 'Meta Ads', '/admin/meta', 'BarChart3', 'integrations', 2),
    (v_zaploto_id, 'flows', 'Flows (Automações)', '/admin/flows', 'Workflow', NULL, 6),
    (v_zaploto_id, 'ai_agents_admin', 'Agentes IA', '/admin/ai-agents', 'Bot', NULL, 7),
    (v_zaploto_id, 'ai_agents', 'Agentes IA', '/ai-agents', 'Bot', NULL, 8),
    (v_zaploto_id, 'chat', 'Chat Interno', '/chat', 'MessageSquare', NULL, 9),
    (v_zaploto_id, 'crm', 'CRM', NULL, 'Layout', NULL, 10),
    (v_zaploto_id, 'crm_kanban', 'Kanban', '/crm/kanban', 'Kanban', 'crm', 0),
    (v_zaploto_id, 'crm_transferido', 'Transferido', '/crm/transferido', 'ArrowRightLeft', 'crm', 1),
    (v_zaploto_id, 'crm_avulsos', 'Avulsos', '/crm/avulsos', 'UserPlus', 'crm', 2),
    (v_zaploto_id, 'campanhas', 'Campanhas', NULL, 'Rocket', NULL, 11),
    (v_zaploto_id, 'campanha_add_group', 'Adição em Grupo', '/add-to-group', 'Rocket', 'campanhas', 0),
    (v_zaploto_id, 'campanha_mensagem', 'Mensagem', '/crm/activations', 'Activity', 'campanhas', 1),
    (v_zaploto_id, 'campanha_grupos', 'Grupos', '/campanha/groups', 'Users', 'campanhas', 2),
    (v_zaploto_id, 'campanha_consultor', 'Campanha', NULL, 'Rocket', NULL, 12),
    (v_zaploto_id, 'campanha_consultor_msg', 'Mensagem', '/crm/activations', 'Activity', 'campanha_consultor', 0),
    (v_zaploto_id, 'campanha_consultor_grupos', 'Grupos', '/campanha/groups', 'Users', 'campanha_consultor', 1),
    (v_zaploto_id, 'contacts', 'Contatos Ativos', '/contacts', 'Users', NULL, 13),
    (v_zaploto_id, 'import_contacts', 'Importar Contatos', '/import-contacts', 'Plus', NULL, 14),
    (v_zaploto_id, 'list_cleaning', 'Limpeza de Lista', '/list-cleaning', 'ListOrdered', NULL, 15),
    (v_zaploto_id, 'auditoria', 'Auditoria', '/admin/audit', 'ClipboardList', NULL, 16),
    (v_zaploto_id, 'anti_spam', 'Anti-Spam', '/admin/anti-spam', 'Shield', NULL, 17),
    (v_zaploto_id, 'meu_anti_spam', 'Meu Anti-Spam', '/anti-spam', 'Shield', NULL, 18),
    (v_zaploto_id, 'gestao_banca', 'Gestão de Banca', '/dono-banca', 'BarChart3', NULL, 18),
    (v_zaploto_id, 'gestao_trafego', 'Gestão de Tráfego', '/gestor-trafego', 'BarChart3', NULL, 19),
    (v_zaploto_id, 'gestao_consultores', 'Gestão de Consultores', '/gerente', 'Briefcase', NULL, 20),
    (v_zaploto_id, 'meu_desempenho', 'Meu Desempenho', '/consultor', 'BarChart3', NULL, 21),
    (v_zaploto_id, 'vsl_redirect', 'VSL & Redirect', '/admin/vsl', 'ExternalLink', NULL, 22),
    (v_zaploto_id, 'profile', 'Meu Perfil', '/perfil', 'User', NULL, 99)
  ON CONFLICT (zaploto_id, code) DO NOTHING;

  -- Obter IDs dos roles
  SELECT id INTO v_role_super FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'super_admin';
  SELECT id INTO v_role_admin FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'admin';
  SELECT id INTO v_role_suporte FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'suporte';
  SELECT id INTO v_role_auditoria FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'auditoria';
  SELECT id INTO v_role_dono FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'dono_banca';
  SELECT id INTO v_role_gestor FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'gestor';
  SELECT id INTO v_role_gerente FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'gerente';
  SELECT id INTO v_role_consultor FROM zaploto_roles WHERE zaploto_id = v_zaploto_id AND code = 'consultor';

  -- role_sidebar: visibilidade por cargo (baseado na análise)
  -- Super Admin vê tudo
  INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
  SELECT v_zaploto_id, v_role_super, si.id, true
  FROM zaploto_sidebar_items si WHERE si.zaploto_id = v_zaploto_id
  ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;

  -- Admin (sem maturador, flows, webhooks, chat, gestao_banca)
  INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
  SELECT v_zaploto_id, v_role_admin, si.id, true
  FROM zaploto_sidebar_items si WHERE si.zaploto_id = v_zaploto_id
  AND si.code NOT IN ('maturador', 'flows', 'integrations', 'webhooks_evolution', 'webhooks_rules', 'meta_ads', 'chat', 'gestao_banca')
  ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;

  -- Suporte
  INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
  SELECT v_zaploto_id, v_role_suporte, si.id, true
  FROM zaploto_sidebar_items si WHERE si.zaploto_id = v_zaploto_id
  AND si.code IN ('dashboard', 'hierarquia', 'instances', 'maturador', 'ai_agents', 'chat', 'crm', 'crm_kanban', 'crm_transferido', 'crm_avulsos',
    'campanhas', 'campanha_add_group', 'campanha_mensagem', 'campanha_grupos', 'contacts', 'import_contacts', 'meu_anti_spam', 'profile')
  ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;

  -- Auditoria
  INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
  SELECT v_zaploto_id, v_role_auditoria, si.id, true
  FROM zaploto_sidebar_items si WHERE si.zaploto_id = v_zaploto_id
  AND si.code IN ('dashboard', 'instances', 'maturador', 'ai_agents', 'crm', 'crm_kanban', 'crm_transferido', 'crm_avulsos',
    'campanhas', 'campanha_add_group', 'campanha_mensagem', 'campanha_grupos', 'contacts', 'import_contacts', 'auditoria', 'anti_spam', 'profile')
  ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;

  -- Dono Banca
  INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
  SELECT v_zaploto_id, v_role_dono, si.id, true
  FROM zaploto_sidebar_items si WHERE si.zaploto_id = v_zaploto_id
  AND si.code IN ('gestao_banca', 'dashboard', 'instances', 'maturador', 'ai_agents', 'crm', 'crm_kanban', 'crm_transferido', 'crm_avulsos',
    'campanhas', 'campanha_add_group', 'campanha_mensagem', 'campanha_grupos', 'contacts', 'import_contacts', 'meu_anti_spam', 'profile')
  ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;

  -- Gestor
  INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
  SELECT v_zaploto_id, v_role_gestor, si.id, true
  FROM zaploto_sidebar_items si WHERE si.zaploto_id = v_zaploto_id
  AND si.code IN ('gestao_trafego', 'vsl_redirect', 'dashboard', 'instances', 'maturador', 'ai_agents', 'crm', 'crm_kanban', 'crm_transferido', 'crm_avulsos',
    'campanhas', 'campanha_add_group', 'campanha_mensagem', 'campanha_grupos', 'contacts', 'import_contacts', 'meu_anti_spam', 'profile')
  ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;

  -- Gerente
  INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
  SELECT v_zaploto_id, v_role_gerente, si.id, true
  FROM zaploto_sidebar_items si WHERE si.zaploto_id = v_zaploto_id
  AND si.code IN ('gestao_consultores', 'dashboard', 'instances', 'ai_agents', 'crm', 'crm_kanban', 'crm_transferido', 'crm_avulsos',
    'campanhas', 'campanha_add_group', 'campanha_mensagem', 'campanha_grupos', 'contacts', 'import_contacts', 'list_cleaning', 'meu_anti_spam', 'profile')
  ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;

  -- Consultor
  INSERT INTO zaploto_role_sidebar (zaploto_id, role_id, sidebar_item_id, visible)
  SELECT v_zaploto_id, v_role_consultor, si.id, true
  FROM zaploto_sidebar_items si WHERE si.zaploto_id = v_zaploto_id
  AND si.code IN ('meu_desempenho', 'instances', 'crm', 'crm_kanban', 'crm_transferido', 'crm_avulsos', 'campanha_consultor', 'campanha_consultor_msg', 'campanha_consultor_grupos', 'ai_agents', 'meu_anti_spam', 'profile')
  ON CONFLICT (role_id, sidebar_item_id) DO UPDATE SET visible = true;

  -- Admin steps
  INSERT INTO zaploto_admin_steps (zaploto_id, code, label, section_type, route, sort_order)
  VALUES
    (v_zaploto_id, 'overview', 'Dashboard', 'tab', NULL, 0),
    (v_zaploto_id, 'users', 'Usuários', 'tab', NULL, 1),
    (v_zaploto_id, 'crm', 'CRM', 'tab', NULL, 2),
    (v_zaploto_id, 'lead_transfer', 'Transferência de Leads', 'link', '/admin/crm/lead-transfer', 3),
    (v_zaploto_id, 'disparo', 'Disparo', 'tab', NULL, 4),
    (v_zaploto_id, 'loto_assistencia', 'Loto Assistência', 'tab', NULL, 5),
    (v_zaploto_id, 'meta_ads', 'Meta Ads', 'link', '/admin/meta', 6),
    (v_zaploto_id, 'vsl_redirect', 'VSL & Redirect', 'link', '/admin/vsl', 7),
    (v_zaploto_id, 'campaigns', 'Campanhas', 'tab', NULL, 8),
    (v_zaploto_id, 'settings', 'Configurações', 'tab', NULL, 9),
    (v_zaploto_id, 'proxys', 'Proxys', 'tab', NULL, 10),
    (v_zaploto_id, 'maturador', 'Maturador', 'tab', NULL, 11)
  ON CONFLICT (zaploto_id, code) DO NOTHING;

  -- role_admin_steps: super_admin vê tudo; admin vê exceto campaigns, settings, proxys, maturador
  INSERT INTO zaploto_role_admin_steps (zaploto_id, role_id, admin_step_id, visible)
  SELECT v_zaploto_id, v_role_super, as2.id, true
  FROM zaploto_admin_steps as2 WHERE as2.zaploto_id = v_zaploto_id
  ON CONFLICT (role_id, admin_step_id) DO UPDATE SET visible = true;

  INSERT INTO zaploto_role_admin_steps (zaploto_id, role_id, admin_step_id, visible)
  SELECT v_zaploto_id, v_role_admin, as2.id, true
  FROM zaploto_admin_steps as2 WHERE as2.zaploto_id = v_zaploto_id
  AND as2.code NOT IN ('campaigns', 'settings', 'proxys', 'maturador')
  ON CONFLICT (role_id, admin_step_id) DO UPDATE SET visible = true;

END $$;
