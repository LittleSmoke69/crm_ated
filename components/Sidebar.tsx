'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { TenantLink } from '@/components/TenantLink';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  MessageSquare,
  Rocket,
  Users,
  Plus,
  X,
  ChevronLeft,
  ChevronRight,
  Shield,
  LogOut,
  ChevronDown,
  ChevronUp,
  Layout,
  Kanban,
  Activity,
  UserCog,
  BarChart3,
  Briefcase,
  Webhook,
  Bot,
  Workflow,
  Settings,
  FlaskConical,
  User,
  ListOrdered,
  ClipboardList,
  ArrowLeftToLine,
  ExternalLink,
  ArrowRightLeft,
  BookOpen,
  Link2,
  Headphones,
  UserPlus,
  Package,
  Globe,
} from 'lucide-react';
import { useSidebar } from '@/contexts/SidebarContext';
import Logo from '@/components/Logo';
import { withTenantSlug } from '@/lib/utils/tenant-href';
import { getInternalAppPathname } from '@/lib/utils/white-label-path';
import { useAdminTenantSwitcher } from '@/contexts/AdminTenantSwitcherContext';

interface SidebarProps {
  onSignOut?: () => void;
}

interface MenuItem {
  href?: string;
  icon: any;
  label: string;
  submenu?: {
    href: string;
    icon: any;
    label: string;
  }[];
}

type UserStatus = 'super_admin' | 'admin' | 'gerente' | 'captador' | null;

/** Cargos legados → cargos atuais (sessões/perfis antigos ainda podem retornar valores aposentados). */
const LEGACY_STATUS_MAP: Record<string, UserStatus> = {
  consultor: 'captador',
  dono_banca: 'gerente',
  gestor: 'admin',
  auditoria: 'admin',
  suporte: 'admin',
};

function normalizeLegacyStatus(status: string | null | undefined): UserStatus {
  const raw = typeof status === 'string' ? status.trim() : '';
  if (!raw) return null;
  return LEGACY_STATUS_MAP[raw] ?? (raw as UserStatus);
}

const Sidebar: React.FC<SidebarProps> = ({ onSignOut }) => {
  const pathname = usePathname();
  const routePath = getInternalAppPathname(pathname);
  const adminTenantCtx = useAdminTenantSwitcher();
  const { isMobileOpen, setIsMobileOpen, isCollapsed, setIsCollapsed } = useSidebar();
  const [userStatus, setUserStatus] = useState<UserStatus>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const [loadingRoute, setLoadingRoute] = useState<string | null>(null);
  const [isImpersonating, setIsImpersonating] = useState(false);

  // Detecta impersonação via cookie no servidor (fonte de verdade) + limpa sessionStorage obsoleto
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;

    const syncImpersonationState = async () => {
      const currentUserId =
        sessionStorage.getItem('user_id') ||
        sessionStorage.getItem('profile_id') ||
        localStorage.getItem('profile_id');
      const adminOriginalId = sessionStorage.getItem('admin_original_id');

      if (adminOriginalId && currentUserId && adminOriginalId === currentUserId) {
        sessionStorage.removeItem('admin_original_id');
        sessionStorage.removeItem('admin_original_email');
      }

      try {
        const res = await fetch('/api/admin/users/impersonation-status', {
          credentials: 'include',
        });
        const result = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (res.ok && result.success && result.data?.impersonating) {
          setIsImpersonating(true);
          if (result.data.adminUserId) {
            sessionStorage.setItem('admin_original_id', result.data.adminUserId);
          }
          return;
        }

        setIsImpersonating(false);
        sessionStorage.removeItem('admin_original_id');
        sessionStorage.removeItem('admin_original_email');
      } catch {
        if (cancelled) return;
        const stale =
          !!sessionStorage.getItem('admin_original_id') &&
          !!currentUserId &&
          sessionStorage.getItem('admin_original_id') !== currentUserId;
        setIsImpersonating(stale);
      }
    };

    syncImpersonationState();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // Verifica se está nas páginas que devem mostrar o botão Sair
  const shouldShowLogout =
    routePath === '/perfil' ||
    routePath === '/list-cleaning' ||
    routePath === '/crm/transferido' ||
    routePath === '/crm/avulsos' ||
    routePath === '/anti-spam' ||
    routePath === '/admin' ||
    routePath?.startsWith('/admin/') ||
    routePath?.startsWith('/gerente/zaplink') ||
    routePath?.startsWith('/gerente/crm/lead-stock') ||
    routePath?.startsWith('/gestor-trafego/zaplink') ||
    onSignOut !== undefined;

  // Função de logout padrão
  const handleDefaultLogout = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
      window.location.href = withTenantSlug('/login');
    }
  };

  // Usa onSignOut se fornecido, senão usa a função padrão
  const handleLogout = onSignOut || handleDefaultLogout;

  const handleBackToAdmin = async () => {
    if (typeof window === 'undefined') return;
    const adminId = sessionStorage.getItem('admin_original_id');
    const adminEmail = sessionStorage.getItem('admin_original_email');
    if (!adminId) {
      sessionStorage.removeItem('admin_original_id');
      sessionStorage.removeItem('admin_original_email');
      window.location.href = withTenantSlug('/admin/login');
      return;
    }

    try {
      const res = await fetch('/api/admin/users/restore-admin-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const result = await res.json().catch(() => ({}));

      if (!res.ok || !result.success) {
        console.error('[RestoreAdmin] Erro:', result);
        sessionStorage.removeItem('admin_original_id');
        sessionStorage.removeItem('admin_original_email');
        setIsImpersonating(false);
        alert(result.error || 'Não foi possível restaurar a sessão de admin.');
        return;
      }

      const restoredAdminId = result.data?.adminUserId || adminId;
      const restoredAdminEmail = result.data?.adminEmail || adminEmail;
      const restoredAdminStatus = result.data?.adminStatus as string | undefined;

      sessionStorage.setItem('user_id', restoredAdminId);
      sessionStorage.setItem('profile_id', restoredAdminId);
      if (restoredAdminEmail) {
        sessionStorage.setItem('profile_email', restoredAdminEmail);
        localStorage.setItem('profile_email', restoredAdminEmail);
      }
      if (restoredAdminStatus) {
        sessionStorage.setItem('profile_status', restoredAdminStatus);
      }
      localStorage.setItem('profile_id', restoredAdminId);
      sessionStorage.removeItem('profile_status');
      sessionStorage.removeItem('zaploto_v1_admin_profile_session_ok_uid');
      sessionStorage.removeItem('admin_original_id');
      sessionStorage.removeItem('admin_original_email');
      setIsImpersonating(false);

      window.location.href = withTenantSlug('/admin');
    } catch (error) {
      console.error('[RestoreAdmin] Erro ao restaurar sessão:', error);
      alert('Erro ao voltar ao painel admin.');
    }
  };

  const [dynamicSidebar, setDynamicSidebar] = useState<{ items: MenuItem[]; useLegacy: boolean } | null>(null);
  /** Evita exibir o menu fallback e depois o menu completo (efeito “piscando”). */
  const [profileReady, setProfileReady] = useState(false);
  const [sidebarReady, setSidebarReady] = useState(false);

  const iconMap: Record<string, any> = {
    LayoutDashboard, MessageSquare, Rocket, Users, Plus, Shield, Webhook, Workflow, Bot, Layout,
    Kanban, Activity, BarChart3, Briefcase, Settings, FlaskConical, User, ListOrdered, ClipboardList,
    ArrowLeftToLine, ExternalLink, ArrowRightLeft, BookOpen, Link2, UserPlus, Headphones, Package,
  };

  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        if (typeof window === 'undefined') return;

        const userId =
          sessionStorage.getItem('user_id') ||
          sessionStorage.getItem('profile_id') ||
          window.localStorage.getItem('profile_id');

        if (!userId) {
          setUserStatus(null);
          setDynamicSidebar(null);
          return;
        }

        const response = await fetch('/api/user/profile', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': userId,
          },
          credentials: 'include',
        });

        if (response.ok) {
          const text = await response.text();
          if (text.trim()) {
            try {
              const result = JSON.parse(text);
              if (result.success && result.data?.status) {
                setUserStatus(normalizeLegacyStatus(String(result.data.status)));
              }
            } catch {
              // resposta inválida
            }
          }
        }
      } catch (error) {
        console.error('Erro ao carregar perfil:', error);
        setUserStatus(null);
      } finally {
        setProfileReady(true);
      }
    };

    loadUserProfile();
  }, []);

  useEffect(() => {
    if (!profileReady) return;

    let cancelled = false;

    const loadSidebarConfig = async () => {
      if (typeof window === 'undefined') return;

      if (!userStatus) {
        setSidebarReady(true);
        return;
      }

      setSidebarReady(false);

      const userId =
        sessionStorage.getItem('user_id') ||
        sessionStorage.getItem('profile_id') ||
        localStorage.getItem('profile_id');
      if (!userId) {
        setSidebarReady(true);
        return;
      }

      try {
        const res = await fetch('/api/zaploto/sidebar', { headers: { 'X-User-Id': userId }, credentials: 'include' });
        const text = await res.text();
        let json: { success?: boolean; data?: { useLegacy?: boolean; items?: unknown[] } } = {};
        if (text.trim()) {
          try {
            json = JSON.parse(text);
          } catch {
            if (!cancelled) setDynamicSidebar({ items: [], useLegacy: true });
            json = {};
          }
        }
        if (cancelled) return;
        if (json.success && !json.data?.useLegacy && Array.isArray(json.data?.items) && json.data.items.length > 0) {
          const toMenuItem = (it: {
            label: string;
            href?: string | null;
            icon_name?: string | null;
            submenu?: { label: string; href?: string | null; icon_name?: string | null }[];
          }): MenuItem => {
            const Icon = (it.icon_name && iconMap[it.icon_name]) || LayoutDashboard;
            const sub = it.submenu?.map((s: { label: string; href?: string | null; icon_name?: string | null }) => ({
              href: s.href || '/',
              icon: (s.icon_name && iconMap[s.icon_name]) || Settings,
              label: s.label,
            }));
            return {
              label: it.label,
              href: it.href || undefined,
              icon: Icon,
              submenu: sub,
            };
          };
          const items = json.data!.items.map((it: unknown) => toMenuItem(it as Parameters<typeof toMenuItem>[0]));
          setDynamicSidebar({ items, useLegacy: false });
        } else {
          setDynamicSidebar({ items: [], useLegacy: true });
        }
      } catch {
        if (!cancelled) setDynamicSidebar({ items: [], useLegacy: true });
      } finally {
        if (!cancelled) setSidebarReady(true);
      }
    };

    loadSidebarConfig();
    return () => {
      cancelled = true;
    };
  }, [profileReady, userStatus]);

  const toggleSubmenu = (label: string) => {
    setOpenSubmenu(openSubmenu === label ? null : label);
  };

  // Blocos reutilizáveis para montagem do menu por cargo
  const itemDashboard: MenuItem = { href: '/', icon: LayoutDashboard, label: 'Dashboard' };
  const itemInstances: MenuItem = { href: '/instances', icon: MessageSquare, label: 'Instâncias WhatsApp' };
  const itemMaturador: MenuItem = { href: '/maturador', icon: FlaskConical, label: 'Maturador' };
  const itemProfile: MenuItem = { href: '/perfil', icon: User, label: 'Meu Perfil' };
  const itemPainelAdmin: MenuItem = { href: '/admin', icon: Shield, label: 'Painel Admin' };
  const itemWhiteLabelAdmin: MenuItem = {
    href: '/admin/zaploto',
    icon: Globe,
    label: 'White Label',
  };
  const itemWebhooks: MenuItem = {
    label: 'Integrações',
    icon: Webhook,
    submenu: [
      { href: '/admin/webhooks/evolution', icon: Webhook, label: 'Webhooks Evolution' },
      { href: '/admin/whatsapp-official', icon: MessageSquare, label: 'WhatsApp Oficial' },
      { href: '/admin/webhooks/normalization-rules', icon: Settings, label: 'Regras de Normalização' },
      { href: '/admin/meta', icon: BarChart3, label: 'Meta Ads' },
    ],
  };
  const itemFlows: MenuItem = { href: '/admin/flows', icon: Workflow, label: 'Flows (Automações)' };
  const itemAgentesIAAdmin: MenuItem = { href: '/admin/ai-agents', icon: Bot, label: 'Agentes IA' };
  const itemAgentesIA: MenuItem = { href: '/ai-agents', icon: Bot, label: 'Agentes IA' };
  const itemChatInterno: MenuItem = { href: '/chat', icon: MessageSquare, label: 'Chat Interno' };
  const itemChatAtendimento: MenuItem = { href: '/chat-atendimento', icon: Headphones, label: 'Chat Atendimento' };
  const itemGestaoChat: MenuItem = {
    href: '/admin/chat-gestao',
    icon: BarChart3,
    label: 'Gestão do Chat',
  };
  const itemLeads: MenuItem = { href: '/admin/leads', icon: UserPlus, label: 'Leads' };
  const itemCRM: MenuItem = {
    label: 'CRM',
    icon: Layout,
    submenu: [
      { href: '/crm/kanban', icon: Kanban, label: 'Kanban' },
      { href: '/crm/transferido', icon: ArrowRightLeft, label: 'Transferido' },
      { href: '/crm/avulsos', icon: UserPlus, label: 'Avulsos' },
    ],
  };
  // Admin/Super Admin: CRM com gestão de leads capturados (Admin > Leads)
  const itemCRMAdmin: MenuItem = {
    label: 'CRM',
    icon: Layout,
    submenu: [
      { href: '/admin/leads', icon: UserPlus, label: 'Leads' },
      { href: '/crm/kanban', icon: Kanban, label: 'Kanban' },
      { href: '/crm/transferido', icon: ArrowRightLeft, label: 'Transferido' },
      { href: '/crm/avulsos', icon: UserPlus, label: 'Avulsos' },
    ],
  };
  const itemCampanhas: MenuItem = {
    label: 'Campanhas',
    icon: Rocket,
    submenu: [
      { href: '/add-to-group', icon: Rocket, label: 'Adição em Grupo' },
      { href: '/crm/activations', icon: Activity, label: 'Mensagem' },
      { href: '/campanha/groups', icon: Users, label: 'Grupos' },
    ],
  };
  // Captador: Campanha > Mensagem (ativações) + Grupos (igual ao gerente para envio de mensagens)
  const itemCampanhaConsultor: MenuItem = {
    label: 'Campanha',
    icon: Rocket,
    submenu: [
      { href: '/crm/activations', icon: Activity, label: 'Mensagem' },
      { href: '/campanha/groups', icon: Users, label: 'Grupos' },
    ],
  };
  const itemContatosAtivos: MenuItem = { href: '/contacts', icon: Users, label: 'Contatos Ativos' };
  const itemImportarContatos: MenuItem = { href: '/import-contacts', icon: Plus, label: 'Importar Contatos' };
  const itemLimpezaLista: MenuItem = { href: '/list-cleaning', icon: ListOrdered, label: 'Limpeza de Lista' };
  const itemAuditoria: MenuItem = { href: '/admin/audit', icon: ClipboardList, label: 'Auditoria' };
  const itemAntiSpam: MenuItem = { href: '/admin/anti-spam', icon: Shield, label: 'Anti-Spam' };
  const itemMeuAntiSpam: MenuItem = { href: '/anti-spam', icon: Shield, label: 'Meu Anti-Spam' };
  const itemGestaoBanca: MenuItem = { href: '/dono-banca', icon: BarChart3, label: 'Gestão de Banca' };
  const itemGestaoTrafego: MenuItem = { href: '/gestor-trafego', icon: BarChart3, label: 'Gestão de Tráfego' };
  const itemGestaoConsultores: MenuItem = { href: '/gerente', icon: Briefcase, label: 'Gestão de Captadores' };
  const itemMeuDesempenho: MenuItem = { href: '/consultor', icon: BarChart3, label: 'Desempenho' };
  const itemDesempenhoDetalhado: MenuItem = { href: '/consultor/detalhado', icon: ClipboardList, label: 'Desempenho Detalhado' };
  const itemMetaAds: MenuItem = { href: '/admin/meta', icon: BarChart3, label: 'Meta Ads' };
  const itemVslRedirect: MenuItem = { href: '/admin/vsl', icon: ExternalLink, label: 'VSL & Redirect' };
  const itemZaplink: MenuItem = { href: '/admin/zaplink', icon: Link2, label: 'Zaplink' };
  const itemZaplinkGerente: MenuItem = { href: '/gerente/zaplink', icon: Link2, label: 'Zaplink' };
  const itemLeadStockGerente: MenuItem = { href: '/gerente/crm/lead-stock-transfer', icon: Package, label: 'Estoque de leads' };
  const itemLeadTransfer: MenuItem = { href: '/admin/crm/lead-transfer', icon: ArrowRightLeft, label: 'Transferência de Leads' };
  const itemAcademy: MenuItem = {
    href: '/admin/academy',
    icon: BookOpen,
    label: 'Academy',
    submenu: [
      { href: '/admin/academy', icon: LayoutDashboard, label: 'Dashboard' },
      { href: '/admin/academy/modulos', icon: Briefcase, label: 'Módulos' },
      { href: '/admin/academy/aulas', icon: Activity, label: 'Aulas' },
      { href: '/admin/academy/assets', icon: ListOrdered, label: 'Materiais' },
      { href: '/admin/academy/analytics', icon: BarChart3, label: 'Analytics' },
    ],
  };
  const itemAcademyPublic: MenuItem = { href: '/academy', icon: BookOpen, label: 'Academy' };
  const itemHierarquia: MenuItem = { href: '/admin/hierarchy', icon: BarChart3, label: 'Hierarquia' };

  // Define menus baseados no status do usuário (matriz de cargos)
  const getMenuItems = (): MenuItem[] => {
    // 👑 SuperAdmin - vê tudo
    if (userStatus === 'super_admin') {
      const wlActive = !!adminTenantCtx?.selectedTenantId;
      return [
        itemDashboard,
        itemInstances,
        itemMaturador,
        itemPainelAdmin,
        ...(wlActive ? [itemWhiteLabelAdmin] : []),
        itemHierarquia,
        itemWebhooks,
        itemFlows,
        itemAgentesIAAdmin,
        itemChatInterno,
        itemGestaoChat,
        itemLeadTransfer,
        itemLeads,
        itemCRMAdmin,
        itemCampanhas,
        itemContatosAtivos,
        itemImportarContatos,
        itemLimpezaLista,
        itemAuditoria,
        itemAntiSpam,
        itemProfile,
        itemGestaoBanca,
        itemGestaoTrafego,
        itemVslRedirect,
        itemZaplink,
        itemGestaoConsultores,
        itemLeadStockGerente,
        itemAcademy,
      ];
    }

    // 🛠️ Admin - painel, CRM, campanhas, instâncias + Integrações (Webhooks, WhatsApp Oficial, Meta) + Gestão de Banca, etc.
    if (userStatus === 'admin') {
      return [
        itemDashboard,
        itemInstances,
        itemPainelAdmin,
        itemHierarquia,
        itemWebhooks,
        itemMetaAds,
        itemVslRedirect,
        itemZaplink,
        itemAcademy,
        itemAgentesIAAdmin,
        itemGestaoChat,
        itemLeads,
        itemCRMAdmin,
        itemCampanhas,
        itemContatosAtivos,
        itemImportarContatos,
        itemLimpezaLista,
        itemAntiSpam,
        itemProfile,
        itemGestaoBanca,
        itemGestaoTrafego,
        itemGestaoConsultores,
        itemLeadStockGerente,
        itemLeadTransfer,
        itemMeuDesempenho,
        itemDesempenhoDetalhado,
      ];
    }

    // 📊 Gerente - Gestão de Captadores + operação (sem Maturador, Flows, Webhooks, Auditoria, Chat, Gestão Banca)
    if (userStatus === 'gerente') {
      return [
        itemGestaoConsultores,
        itemMeuDesempenho,
        itemDesempenhoDetalhado,
        itemLeadTransfer,
        itemLeadStockGerente,
        itemGestaoTrafego,
        itemZaplinkGerente,
        itemDashboard,
        itemInstances,
        itemChatAtendimento,
        itemGestaoChat,
        itemAgentesIA,
        itemAcademyPublic,
        itemCRM,
        itemCampanhas,
        itemContatosAtivos,
        itemImportarContatos,
        itemLimpezaLista,
        itemMeuAntiSpam,
        itemProfile,
      ];
    }

    // 👨‍💼 Captador - operacional (Meu Desempenho, Instâncias, CRM, Campanha > Grupos, Agentes IA, Meu Anti-Spam, Meu Perfil)
    if (userStatus === 'captador') {
      return [
        itemMeuDesempenho,
        itemDesempenhoDetalhado,
        itemInstances,
        itemChatAtendimento,
        itemCRM,
        itemCampanhaConsultor,
        itemAgentesIA,
        itemAcademyPublic,
        itemMeuAntiSpam,
        itemProfile,
      ];
    }

    // Fallback - status ainda não carregou ou desconhecido
    return [
      itemDashboard,
      itemInstances,
      itemMaturador,
      itemAcademyPublic,
      itemProfile,
    ];
  };

  const menuItems = useMemo(
    () => {
      const legacy = getMenuItems();
      if (!(dynamicSidebar && !dynamicSidebar.useLegacy && dynamicSidebar.items.length > 0)) {
        return legacy;
      }

      const items = dynamicSidebar.items.map((item) => ({ ...item, submenu: item.submenu ? [...item.submenu] : undefined }));
      const hasLeads =
        items.some((it) => it.href === '/admin/leads' || it.label === 'Leads') ||
        items.some((it) => it.submenu?.some((s) => s.href === '/admin/leads' || s.label === 'Leads'));

      // Garante "Leads" para admin/super_admin mesmo se o seed dinâmico não tiver crm_leads
      if (!hasLeads && (userStatus === 'super_admin' || userStatus === 'admin')) {
        const crmIdx = items.findIndex((it) => it.label === 'CRM');
        const leadsSub = { href: '/admin/leads', icon: UserPlus, label: 'Leads' };
        if (crmIdx >= 0) {
          const crm = items[crmIdx];
          items[crmIdx] = {
            ...crm,
            submenu: [leadsSub, ...(crm.submenu || [])],
          };
        } else {
          items.splice(0, 0, itemLeads);
        }
      }

      return items;
    },
    [dynamicSidebar, userStatus]
  );

  const menuReady = profileReady && sidebarReady;

  // Abrir o submenu se algum item dele estiver ativo
  useEffect(() => {
    if (!menuReady) return;
    const activeSubmenu = menuItems.find(item => 
      item.submenu?.some(sub => isActive(sub.href))
    );
    if (activeSubmenu) {
      setOpenSubmenu(activeSubmenu.label);
    }
  }, [pathname, routePath, userStatus, menuReady, menuItems]);

  // Limpa o loading quando a rota mudar para a página desejada
  useEffect(() => {
    if (loadingRoute && routePath === loadingRoute) {
      // Pequeno delay para garantir que a página começou a carregar
      const timer = setTimeout(() => {
        setLoadingRoute(null);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [routePath, loadingRoute]);

  const isActive = (href: string) => {
    if (href === '/') {
      return routePath === '/';
    }
    // Para /admin, só destaca se for exatamente /admin (não /admin/...)
    if (href === '/admin') {
      return routePath === '/admin';
    }
    // Para /gerente, só destaca na página principal (não em /gerente/zaplink, etc.)
    if (href === '/gerente') {
      return routePath === '/gerente';
    }
    // Para /gestor-trafego, só destaca na página principal (não em /gestor-trafego/zaplink, etc.)
    if (href === '/gestor-trafego') {
      return routePath === '/gestor-trafego';
    }
    // Para outros paths, verifica se começa com o href
    return routePath.startsWith(href);
  };

  return (
    <>
      {/* Overlay for mobile */}
      {isMobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-white/70 dark:bg-black/60 backdrop-blur-[1px] z-40"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed left-0 top-0 h-full max-h-[100dvh] bg-white/90 dark:bg-[#160f0a]/85 backdrop-blur-md shadow-lg z-40 border-r border-gray-200 dark:border-[#E86A24]/15
          transform transition-all duration-300 ease-in-out
          ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0
          w-64
          ${!isMobileOpen && isCollapsed ? 'lg:w-20' : 'lg:w-64'}
          flex flex-col min-h-0
        `}
        data-collapsed={isCollapsed}
      >
        {/* Logo e Botão de Toggle */}
        <div
          className={`flex items-center border-b border-gray-200 p-4 dark:border-[#404040] ${
            !isMobileOpen && isCollapsed ? 'flex-col gap-2' : 'justify-between'
          }`}
        >
          {(isMobileOpen || !isCollapsed) && (
            <Logo size="lg" className="min-w-0 flex-1" />
          )}
          {/* Botão X no mobile para fechar a sidebar */}
          {isMobileOpen && (
            <button
              onClick={() => setIsMobileOpen(false)}
              className="lg:hidden flex items-center justify-center w-9 h-9 rounded-lg hover:bg-gray-100 dark:hover:bg-[#333] transition text-gray-600 dark:text-[#ccc]"
              aria-label="Fechar menu"
              type="button"
            >
              <X className="w-5 h-5" />
            </button>
          )}
          {!isMobileOpen && isCollapsed && (
            <div className="flex w-full items-center justify-center">
              <Logo size="sm" className="w-full" />
            </div>
          )}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="hidden lg:flex items-center justify-center w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-[#333] transition text-gray-600 dark:text-[#ccc]"
            aria-label="Toggle sidebar"
          >
            {isCollapsed ? (
              <ChevronRight className="w-5 h-5" />
            ) : (
              <ChevronLeft className="w-5 h-5" />
            )}
          </button>
        </div>

        {/* Corpo: menu rolável + rodapé sempre visível (Sair / Voltar admin) */}
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          <nav
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain p-2 space-y-1"
            aria-label="Menu principal"
          >
            {!menuReady ? (
              <div
                className="flex flex-col gap-1 py-1"
                aria-busy="true"
                aria-live="polite"
              >
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg min-h-[44px] ${
                      isMobileOpen || !isCollapsed ? 'justify-start' : 'justify-center'
                    }`}
                  >
                    <div
                      className="shrink-0 rounded-xl bg-gray-300/70 dark:bg-[#3a3a3d] animate-pulse motion-reduce:animate-none motion-reduce:opacity-50"
                      style={{
                        width: '2.5rem',
                        height: '2.5rem',
                        animationDelay: `${i * 85}ms`,
                      }}
                      aria-hidden
                    />
                    {(isMobileOpen || !isCollapsed) && (
                      <div
                        className="h-3.5 flex-1 rounded-md bg-gray-300/60 dark:bg-[#353538] animate-pulse motion-reduce:animate-none motion-reduce:opacity-40 max-w-[min(168px,72%)]"
                        style={{ animationDelay: `${i * 85 + 45}ms` }}
                        aria-hidden
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              menuItems.map((item) => {
              const Icon = item.icon;
              const hasSubmenu = !!item.submenu;
              const isExpanded = openSubmenu === item.label;
              const active = item.href ? isActive(item.href) : (item.submenu?.some(sub => isActive(sub.href)));
              
              if (hasSubmenu) {
                return (
                  <div key={item.label} className="w-full">
                    <button
                      onClick={() => {
                        if (isCollapsed && !isMobileOpen) {
                          setIsCollapsed(false);
                          setOpenSubmenu(item.label);
                        } else {
                          toggleSubmenu(item.label);
                        }
                      }}
                      className={`
                        w-full flex items-center justify-between px-3 py-3 rounded-lg transition-all duration-200
                        ${isMobileOpen ? '' : isCollapsed ? 'justify-center' : ''}
                        ${
                          active && !isExpanded
                            ? 'text-white shadow-md'
                            : 'text-gray-700 dark:text-[#ccc] hover:bg-[#E86A24]/10 dark:hover:bg-[#E86A24]/10 hover:text-[#E86A24] dark:hover:text-[#E86A24]'
                        }
                      `}
                      style={active && !isExpanded ? { backgroundColor: 'var(--zaploto-green)' } : {}}
                      title={isCollapsed && !isMobileOpen ? item.label : undefined}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="w-5 h-5 flex-shrink-0" />
                        {(isMobileOpen || !isCollapsed) && (
                          <span className="font-medium whitespace-nowrap">{item.label}</span>
                        )}
                      </div>
                      {(isMobileOpen || !isCollapsed) && (
                        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                      )}
                    </button>
                    
                    {isExpanded && (isMobileOpen || !isCollapsed) && (
                      <div className="mt-1 ml-4 pl-4 border-l-2 space-y-1" style={{ borderColor: '#E86A2440' }}>
                        {item.submenu?.map((sub) => {
                          const SubIcon = sub.icon;
                          const subHref = sub.href ?? '/';
                          const subActive = isActive(subHref);
                          return (
                            <TenantLink
                              key={subHref || sub.label}
                              href={subHref}
                              onClick={() => {
                                if (window.innerWidth < 1024) {
                                  setIsMobileOpen(false);
                                }
                              }}
                              className={`
                                flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200
                                ${subActive ? 'font-semibold' : 'text-gray-600 dark:text-[#aaa] hover:bg-[#E86A24]/10 dark:hover:bg-[#E86A24]/10 hover:text-[#E86A24] dark:hover:text-[#E86A24]'}
                              `}
                              style={subActive ? { 
                                color: 'var(--zaploto-green)', 
                                backgroundColor: 'var(--zaploto-green-bg)' 
                              } : {}}
                            >
                              {SubIcon && <SubIcon className="w-4 h-4 flex-shrink-0" />}
                              <span className="text-sm whitespace-nowrap">{sub.label}</span>
                            </TenantLink>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              // Verifica se é o link "Métricas da Banca" ou "Gestão de Tráfego" e está carregando
              const isDonoBancaLink = item.href === '/dono-banca';
              const isGestorTrafegoLink = item.href === '/gestor-trafego';
              const isLoadingDonoBanca = loadingRoute === '/dono-banca';
              const isLoadingGestorTrafego = loadingRoute === '/gestor-trafego';

              return (
                <TenantLink
                  key={item.href || item.label}
                  href={item.href || '#'}
                  prefetch={item.href === '/admin' ? false : undefined}
                  onClick={(e) => {
                    if (window.innerWidth < 1024) {
                      setIsMobileOpen(false);
                    }
                    // Se for o link "Métricas da Banca" ou "Gestão de Tráfego", ativa o loading
                    if ((isDonoBancaLink || isGestorTrafegoLink) && item.href) {
                      setLoadingRoute(item.href);
                      setTimeout(() => {
                        if (routePath === item.href) {
                          setLoadingRoute(null);
                        }
                      }, 5000);
                    }
                  }}
                  className={`
                    w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-all duration-200
                    ${isMobileOpen ? '' : isCollapsed ? 'justify-center' : ''}
                    ${
                      active
                        ? 'text-white shadow-md'
                        : 'text-gray-700 dark:text-[#ccc] hover:bg-[#E86A24]/10 dark:hover:bg-[#E86A24]/10 hover:text-[#E86A24] dark:hover:text-[#E86A24]'
                    }
                    ${isLoadingDonoBanca ? 'opacity-75 cursor-wait' : ''}
                  `}
                  style={active ? { backgroundColor: 'var(--zaploto-green)' } : {}}
                  title={isMobileOpen ? undefined : isCollapsed ? item.label : undefined}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  {(isMobileOpen || !isCollapsed) && (
                    <span className="font-medium whitespace-nowrap">{item.label}</span>
                  )}
                </TenantLink>
              );
            })
            )}
          </nav>

          {/* Voltar ao admin (quando está acessando conta de outro usuário) */}
          {isImpersonating && (
            <div className="flex-shrink-0 border-t border-gray-200 dark:border-[#404040] px-2 pt-3 pb-2">
              <button
                onClick={() => {
                  setIsMobileOpen(false);
                  handleBackToAdmin();
                }}
                className={`
                  w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-all duration-200
                  ${isMobileOpen ? '' : isCollapsed ? 'justify-center' : ''}
                  text-white shadow-md
                `}
                style={{ backgroundColor: '#E86A24' }}
                title={isMobileOpen ? undefined : isCollapsed ? 'Voltar ao admin' : undefined}
              >
                <ArrowLeftToLine className="w-5 h-5 flex-shrink-0" />
                {(isMobileOpen || !isCollapsed) && (
                  <span className="font-medium whitespace-nowrap">Voltar ao admin</span>
                )}
              </button>
            </div>
          )}

          {/* Botão Sair: fora do scroll do menu para ficar sempre visível em qualquer altura */}
          {shouldShowLogout && (
            <div
              className="flex-shrink-0 border-t border-gray-200 dark:border-[#404040] px-2 pt-3 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))]"
            >
              <button
                onClick={() => {
                  setIsMobileOpen(false);
                  handleLogout();
                }}
                className={`
                  w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-all duration-200
                  ${isMobileOpen ? '' : isCollapsed ? 'justify-center' : ''}
                  text-white bg-red-600 hover:bg-red-700 shadow-md
                `}
                title={isMobileOpen ? undefined : isCollapsed ? 'Sair' : undefined}
              >
                <LogOut className="w-5 h-5 flex-shrink-0" />
                {(isMobileOpen || !isCollapsed) && (
                  <span className="font-medium whitespace-nowrap">Sair</span>
                )}
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
