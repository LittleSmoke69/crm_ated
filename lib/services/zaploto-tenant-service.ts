/**
 * Serviço para tenants (white label) e permissões dinâmicas.
 * Usado no backend com supabaseServiceRole.
 */

import { supabaseServiceRole } from './supabase-service';

export interface ZaplotoTenant {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  secondary_color: string | null;
  app_title: string | null;
  support_email: string | null;
  is_active: boolean;
  is_central?: boolean;
  created_at: string;
  updated_at: string;
}

export interface ZaplotoRole {
  id: string;
  zaploto_id: string;
  code: string;
  label: string;
  description: string | null;
  sort_order: number;
  can_have_enroller: boolean;
  landing_route: string | null;
  is_system: boolean;
}

export interface SidebarItem {
  id: string;
  code: string;
  label: string;
  href: string | null;
  icon_name: string | null;
  parent_code: string | null;
  sort_order: number;
  submenu?: SidebarItem[];
}

export interface AdminStep {
  id: string;
  code: string;
  label: string;
  section_type: 'tab' | 'link';
  route: string | null;
  sort_order: number;
  /** Se false: pode ver mas não executar ações sensíveis (ex: transferir leads, editar Evolution API) */
  can_execute?: boolean;
}

const DEFAULT_ZAPLOTO_ID = '00000000-0000-0000-0000-000000000001';

/** Retorna tenant por ID ou slug */
export async function getTenantByIdOrSlug(
  idOrSlug: string
): Promise<ZaplotoTenant | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  const { data, error } = await supabaseServiceRole
    .from('zaploto_tenants')
    .select('*')
    .eq(isUuid ? 'id' : 'slug', idOrSlug)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) return null;
  return data as ZaplotoTenant;
}

/** Retorna tenant do usuário (via profile.zaploto_id) */
export async function getTenantForUser(userId: string): Promise<ZaplotoTenant | null> {
  const { data: profile } = await supabaseServiceRole
    .from('profiles')
    .select('zaploto_id')
    .eq('id', userId)
    .single();

  const zaplotoId = profile?.zaploto_id || DEFAULT_ZAPLOTO_ID;
  return getTenantByIdOrSlug(zaplotoId);
}

/** Retorna role por zaploto_id e code (status) */
export async function getRoleByCode(
  zaplotoId: string,
  status: string
): Promise<ZaplotoRole | null> {
  const { data, error } = await supabaseServiceRole
    .from('zaploto_roles')
    .select('*')
    .eq('zaploto_id', zaplotoId)
    .eq('code', status)
    .maybeSingle();

  if (error || !data) return null;
  return data as ZaplotoRole;
}

/** Retorna itens da sidebar visíveis para o role (fallback: usa lógica legada se não houver dados) */
export async function getSidebarItemsForRole(
  zaplotoId: string,
  roleCode: string
): Promise<SidebarItem[]> {
  const role = await getRoleByCode(zaplotoId, roleCode);
  if (!role) return [];

  const { data: roleSidebar } = await supabaseServiceRole
    .from('zaploto_role_sidebar')
    .select(`
      sidebar_item_id,
      visible,
      zaploto_sidebar_items (
        id,
        code,
        label,
        href,
        icon_name,
        parent_code,
        sort_order
      )
    `)
    .eq('role_id', role.id)
    .eq('visible', true);

  if (!roleSidebar || roleSidebar.length === 0) return [];

  const items = roleSidebar
    .map((r: any) => r.zaploto_sidebar_items)
    .filter(Boolean)
    .map((si: any) => ({
      id: si.id,
      code: si.code,
      label: si.label,
      href: si.href,
      icon_name: si.icon_name,
      parent_code: si.parent_code,
      sort_order: si.sort_order,
    })) as SidebarItem[];

  // Agrupar submenus
  const root = items.filter((i) => !i.parent_code);
  const byParent = new Map<string, SidebarItem[]>();
  for (const item of items) {
    if (item.parent_code) {
      const list = byParent.get(item.parent_code) || [];
      list.push(item);
      byParent.set(item.parent_code, list);
    }
  }
  for (const item of root) {
    const subs = (byParent.get(item.code) || [])
      .filter((s: SidebarItem) => s.href) // exclui itens sem href (ex: list_cleaning_dedup, list_cleaning_whatsapp - permissões)
      .sort((a: SidebarItem, b: SidebarItem) => a.sort_order - b.sort_order);
    if (subs.length) {
      item.submenu = subs;
    }
  }

  return root.sort((a, b) => a.sort_order - b.sort_order);
}

/** Retorna steps do admin visíveis para o role */
export async function getAdminStepsForRole(
  zaplotoId: string,
  roleCode: string
): Promise<AdminStep[]> {
  const role = await getRoleByCode(zaplotoId, roleCode);
  if (!role) return [];

  const { data: roleSteps } = await supabaseServiceRole
    .from('zaploto_role_admin_steps')
    .select(`
      admin_step_id,
      can_execute,
      zaploto_admin_steps (
        id,
        code,
        label,
        section_type,
        route,
        sort_order
      )
    `)
    .eq('role_id', role.id)
    .eq('visible', true);

  if (!roleSteps || roleSteps.length === 0) return [];

  const steps = roleSteps
    .filter((r: any) => r.zaploto_admin_steps)
    .map((r: any) => {
      const s = r.zaploto_admin_steps;
      return {
        id: s.id,
        code: s.code,
        label: s.label,
        section_type: s.section_type,
        route: s.route,
        sort_order: s.sort_order,
        can_execute: r.can_execute !== false,
      };
    }) as AdminStep[];

  return steps.sort((a, b) => a.sort_order - b.sort_order);
}

/** Retorna permissão (visible, can_execute) para um step específico */
export async function getAdminStepPermission(
  zaplotoId: string,
  roleCode: string,
  stepCode: string
): Promise<{ visible: boolean; can_execute: boolean }> {
  const role = await getRoleByCode(zaplotoId, roleCode);
  if (!role) return { visible: false, can_execute: false };

  const { data: step } = await supabaseServiceRole
    .from('zaploto_admin_steps')
    .select('id')
    .eq('zaploto_id', zaplotoId)
    .eq('code', stepCode)
    .maybeSingle();
  if (!step) return { visible: false, can_execute: false };

  const { data } = await supabaseServiceRole
    .from('zaploto_role_admin_steps')
    .select('visible, can_execute')
    .eq('role_id', role.id)
    .eq('admin_step_id', step.id)
    .maybeSingle();

  if (!data || !data.visible) return { visible: false, can_execute: false };
  return {
    visible: true,
    can_execute: data.can_execute !== false,
  };
}

/** Verifica se tabelas zaploto existem (para fallback legado) */
export async function hasZaplotoTables(): Promise<boolean> {
  const { data, error } = await supabaseServiceRole
    .from('zaploto_tenants')
    .select('id')
    .limit(1);

  return !error && (data?.length ?? 0) > 0;
}
