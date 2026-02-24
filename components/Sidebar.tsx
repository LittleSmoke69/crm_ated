'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
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
} from 'lucide-react';
import { useSidebar } from '@/contexts/SidebarContext';
import Logo from '@/components/Logo';

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

type UserStatus = 'super_admin' | 'admin' | 'consultor' | 'gerente' | 'dono_banca' | 'gestor' | 'auditoria' | 'suporte' | null;

const Sidebar: React.FC<SidebarProps> = ({ onSignOut }) => {
  const pathname = usePathname();
  const router = useRouter();
  const { isMobileOpen, setIsMobileOpen, isCollapsed, setIsCollapsed } = useSidebar();
  const [userStatus, setUserStatus] = useState<UserStatus>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const [loadingRoute, setLoadingRoute] = useState<string | null>(null);
  const [isImpersonating, setIsImpersonating] = useState(false);

  // Detecta modo impersonação (admin acessando conta de outro usuário)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsImpersonating(!!sessionStorage.getItem('admin_original_id'));
  }, [pathname]);

  // Verifica se está nas páginas que devem mostrar o botão Sair
  const shouldShowLogout = pathname === '/perfil' || 
                          pathname === '/list-cleaning' ||
                          pathname === '/crm/transferido' ||
                          pathname?.startsWith('/admin/webhooks') ||
                          pathname?.startsWith('/admin/whatsapp-official') ||
                          pathname?.startsWith('/admin/meta') ||
                          pathname?.startsWith('/admin/crm/lead-transfer') ||
                          pathname?.startsWith('/admin/hierarchy') ||
                          onSignOut !== undefined;

  // Função de logout padrão
  const handleDefaultLogout = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
      window.location.href = '/login';
    }
  };

  // Usa onSignOut se fornecido, senão usa a função padrão
  const handleLogout = onSignOut || handleDefaultLogout;

  const handleBackToAdmin = () => {
    if (typeof window === 'undefined') return;
    const adminId = sessionStorage.getItem('admin_original_id');
    const adminEmail = sessionStorage.getItem('admin_original_email');
    if (!adminId) {
      sessionStorage.removeItem('admin_original_id');
      sessionStorage.removeItem('admin_original_email');
      window.location.href = '/admin/login';
      return;
    }
    // Limpa sessão atual (usuário impersonado)
    sessionStorage.removeItem('user_id');
    sessionStorage.removeItem('profile_id');
    sessionStorage.removeItem('profile_email');
    localStorage.removeItem('profile_id');
    localStorage.removeItem('profile_email');
    document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
    // Restaura sessão do admin
    sessionStorage.setItem('user_id', adminId);
    sessionStorage.setItem('profile_id', adminId);
    if (adminEmail) {
      sessionStorage.setItem('profile_email', adminEmail);
      localStorage.setItem('profile_email', adminEmail);
    }
    localStorage.setItem('profile_id', adminId);
    const isHttps = window.location.protocol === 'https:';
    const secureAttr = isHttps ? ' Secure;' : '';
    document.cookie = `user_id=${encodeURIComponent(adminId)}; Path=/; SameSite=Lax;${secureAttr}`;
    sessionStorage.removeItem('admin_original_id');
    sessionStorage.removeItem('admin_original_email');
    window.location.href = '/admin';
  };

  const [dynamicSidebar, setDynamicSidebar] = useState<{ items: MenuItem[]; useLegacy: boolean } | null>(null);

  const iconMap: Record<string, any> = {
    LayoutDashboard, MessageSquare, Rocket, Users, Plus, Shield, Webhook, Workflow, Bot, Layout,
    Kanban, Activity, BarChart3, Briefcase, Settings, FlaskConical, User, ListOrdered, ClipboardList,
    ArrowLeftToLine, ExternalLink, ArrowRightLeft, BookOpen,
  };

  useEffect(() => {
    const loadUserProfile = async () => {
      if (typeof window === 'undefined') return;
      
      const userId = sessionStorage.getItem('user_id') || 
                     sessionStorage.getItem('profile_id') || 
                     window.localStorage.getItem('profile_id');
      
      if (!userId) {
        setUserStatus(null);
        setDynamicSidebar(null);
        return;
      }

      try {
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
          if (!text.trim()) return;
          try {
            const result = JSON.parse(text);
            if (result.success && result.data?.status) {
              setUserStatus(result.data.status as UserStatus);
            }
          } catch {
            // resposta vazia ou inválida
          }
        }
      } catch (error) {
        console.error('Erro ao carregar perfil:', error);
        setUserStatus(null);
      }
    };

    loadUserProfile();
  }, []);

  useEffect(() => {
    const loadSidebar = async () => {
      if (typeof window === 'undefined' || !userStatus) return;
      const userId = sessionStorage.getItem('user_id') || sessionStorage.getItem('profile_id') || localStorage.getItem('profile_id');
      if (!userId) return;
      try {
        const res = await fetch('/api/zaploto/sidebar', { headers: { 'X-User-Id': userId }, credentials: 'include' });
        const text = await res.text();
        let json: { success?: boolean; data?: { useLegacy?: boolean; items?: unknown[] } } = {};
        if (text.trim()) {
          try {
            json = JSON.parse(text);
          } catch {
            setDynamicSidebar({ items: [], useLegacy: true });
            return;
          }
        }
        if (json.success && !json.data?.useLegacy && Array.isArray(json.data?.items) && json.data.items.length > 0) {
          const toMenuItem = (it: { label: string; href?: string | null; icon_name?: string | null; submenu?: { label: string; href?: string | null; icon_name?: string | null }[] }): MenuItem => {
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
          const items = json.data.items.map((it: unknown) => toMenuItem(it as Parameters<typeof toMenuItem>[0]));
          setDynamicSidebar({ items, useLegacy: false });
        } else {
          setDynamicSidebar({ items: [], useLegacy: true });
        }
      } catch {
        setDynamicSidebar({ items: [], useLegacy: true });
      }
    };
    loadSidebar();
  }, [userStatus]);

  const toggleSubmenu = (label: string) => {
    setOpenSubmenu(openSubmenu === label ? null : label);
  };

  // Blocos reutilizáveis para montagem do menu por cargo
  const itemDashboard: MenuItem = { href: '/', icon: LayoutDashboard, label: 'Dashboard' };
  const itemInstances: MenuItem = { href: '/instances', icon: MessageSquare, label: 'Instâncias WhatsApp' };
  const itemMaturador: MenuItem = { href: '/maturador', icon: FlaskConical, label: 'Maturador' };
  const itemProfile: MenuItem = { href: '/perfil', icon: User, label: 'Meu Perfil' };
  const itemPainelAdmin: MenuItem = { href: '/admin', icon: Shield, label: 'Painel Admin' };
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
  const itemCRM: MenuItem = {
    label: 'CRM',
    icon: Layout,
    submenu: [
      { href: '/crm/kanban', icon: Kanban, label: 'Kanban' },
      { href: '/crm/transferido', icon: ArrowRightLeft, label: 'Transferido' },
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
  // Consultor: Campanha > Mensagem (ativações) + Grupos (igual ao gerente para envio de mensagens)
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
  const itemGestaoConsultores: MenuItem = { href: '/gerente', icon: Briefcase, label: 'Gestão de Consultores' };
  const itemMeuDesempenho: MenuItem = { href: '/consultor', icon: BarChart3, label: 'Meu Desempenho' };
  const itemMetaAds: MenuItem = { href: '/admin/meta', icon: BarChart3, label: 'Meta Ads' };
  const itemVslRedirect: MenuItem = { href: '/admin/vsl', icon: ExternalLink, label: 'VSL & Redirect' };
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
      return [
        itemDashboard,
        itemInstances,
        itemMaturador,
        itemPainelAdmin,
        itemHierarquia,
        itemWebhooks,
        itemFlows,
        itemAgentesIAAdmin,
        itemChatInterno,
        itemCRM,
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
        itemGestaoConsultores,
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
        itemAcademy,
        itemAgentesIAAdmin,
        itemCRM,
        itemCampanhas,
        itemContatosAtivos,
        itemImportarContatos,
        itemLimpezaLista,
        itemAntiSpam,
        itemProfile,
        itemGestaoBanca,
        itemGestaoTrafego,
        itemGestaoConsultores,
        itemMeuDesempenho,
      ];
    }

    // 🎧 Suporte - atendimento, operação e Hierarquia (alterações na rede)
    if (userStatus === 'suporte') {
      return [
        itemDashboard,
        itemHierarquia,
        itemInstances,
        itemMaturador,
        itemAgentesIA,
        itemAcademyPublic,
        itemChatInterno,
        itemCRM,
        itemCampanhas,
        itemContatosAtivos,
        itemImportarContatos,
        itemMeuAntiSpam,
        itemProfile,
      ];
    }

    // 🕵️ Auditoria - controle, fraude e qualidade (sem Flows, Webhooks, Chat Interno, Gestão)
    if (userStatus === 'auditoria') {
      return [
        itemDashboard,
        itemInstances,
        itemMaturador,
        itemAgentesIA,
        itemAcademyPublic,
        itemCRM,
        itemCampanhas,
        itemContatosAtivos,
        itemImportarContatos,
        itemAuditoria,
        itemAntiSpam,
        itemProfile,
      ];
    }

    // 💰 Dono de Banca - Gestão de Banca + operação (sem Flows, Webhooks, Auditoria, Chat, Gestão Consultores)
    if (userStatus === 'dono_banca') {
      return [
        itemGestaoBanca,
        itemDashboard,
        itemInstances,
        itemMaturador,
        itemAgentesIA,
        itemAcademyPublic,
        itemCRM,
        itemCampanhas,
        itemContatosAtivos,
        itemImportarContatos,
        itemMeuAntiSpam,
        itemProfile,
      ];
    }

    // 📈 Gestor de Tráfego - Painel igual ao dono da banca + funil Facebook (vinculado a um dono)
    if (userStatus === 'gestor') {
      return [
        itemGestaoTrafego,
        itemVslRedirect,
        itemDashboard,
        itemInstances,
        itemMaturador,
        itemAgentesIA,
        itemAcademyPublic,
        itemCRM,
        itemCampanhas,
        itemContatosAtivos,
        itemImportarContatos,
        itemMeuAntiSpam,
        itemProfile,
      ];
    }

    // 📊 Gerente - Gestão de Consultores + operação (sem Maturador, Flows, Webhooks, Auditoria, Chat, Gestão Banca)
    if (userStatus === 'gerente') {
      return [
        itemGestaoConsultores,
        itemDashboard,
        itemInstances,
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

    // 👨‍💼 Consultor - operacional (Meu Desempenho, Instâncias, CRM, Campanha > Grupos, Agentes IA, Meu Anti-Spam, Meu Perfil)
    if (userStatus === 'consultor') {
      return [
        itemMeuDesempenho,
        itemInstances,
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

  const menuItems = (dynamicSidebar && !dynamicSidebar.useLegacy && dynamicSidebar.items.length > 0)
    ? dynamicSidebar.items
    : getMenuItems();

  // Abrir o submenu se algum item dele estiver ativo
  useEffect(() => {
    const activeSubmenu = menuItems.find(item => 
      item.submenu?.some(sub => isActive(sub.href))
    );
    if (activeSubmenu) {
      setOpenSubmenu(activeSubmenu.label);
    }
  }, [pathname, userStatus]);

  // Limpa o loading quando a rota mudar para a página desejada
  useEffect(() => {
    if (loadingRoute && pathname === loadingRoute) {
      // Pequeno delay para garantir que a página começou a carregar
      const timer = setTimeout(() => {
        setLoadingRoute(null);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [pathname, loadingRoute]);

  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === '/';
    }
    // Para /admin, só destaca se for exatamente /admin (não /admin/...)
    if (href === '/admin') {
      return pathname === '/admin';
    }
    // Para outros paths, verifica se começa com o href
    return pathname?.startsWith(href);
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
          fixed left-0 top-0 h-full bg-gray-100 dark:bg-[#2a2a2a] shadow-lg z-40 border-r border-gray-200 dark:border-[#404040]
          transform transition-all duration-300 ease-in-out
          ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0
          w-64
          ${!isMobileOpen && isCollapsed ? 'lg:w-20' : 'lg:w-64'}
          flex flex-col
        `}
        data-collapsed={isCollapsed}
      >
        {/* Logo e Botão de Toggle */}
        <div className="p-4 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between">
          {(isMobileOpen || !isCollapsed) && (
            <Logo size="lg" />
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
            <div className="flex items-center justify-center w-full">
              <Logo size="sm" />
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

        {/* Navigation */}
        <nav className="p-2 space-y-1 flex-1 flex flex-col overflow-y-auto">
          <div className="flex-1">
            {menuItems.map((item) => {
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
                            : 'text-gray-700 dark:text-[#ccc] hover:bg-[#8CD955]/10 dark:hover:bg-[#8CD955]/10 hover:text-[#8CD955] dark:hover:text-[#8CD955]'
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
                      <div className="mt-1 ml-4 pl-4 border-l-2 space-y-1" style={{ borderColor: '#8CD95540' }}>
                        {item.submenu?.map((sub) => {
                          const SubIcon = sub.icon;
                          const subHref = sub.href ?? '/';
                          const subActive = isActive(subHref);
                          return (
                            <Link
                              key={subHref || sub.label}
                              href={subHref}
                              onClick={() => {
                                if (window.innerWidth < 1024) {
                                  setIsMobileOpen(false);
                                }
                              }}
                              className={`
                                flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200
                                ${subActive ? 'font-semibold' : 'text-gray-600 dark:text-[#aaa] hover:bg-[#8CD955]/10 dark:hover:bg-[#8CD955]/10 hover:text-[#8CD955] dark:hover:text-[#8CD955]'}
                              `}
                              style={subActive ? { 
                                color: 'var(--zaploto-green)', 
                                backgroundColor: 'var(--zaploto-green-bg)' 
                              } : {}}
                            >
                              {SubIcon && <SubIcon className="w-4 h-4 flex-shrink-0" />}
                              <span className="text-sm whitespace-nowrap">{sub.label}</span>
                            </Link>
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
                <Link
                  key={item.href || item.label}
                  href={item.href || '#'}
                  onClick={(e) => {
                    if (window.innerWidth < 1024) {
                      setIsMobileOpen(false);
                    }
                    // Se for o link "Métricas da Banca" ou "Gestão de Tráfego", ativa o loading
                    if ((isDonoBancaLink || isGestorTrafegoLink) && item.href) {
                      setLoadingRoute(item.href);
                      setTimeout(() => {
                        if (pathname === item.href) {
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
                        : 'text-gray-700 dark:text-[#ccc] hover:bg-[#8CD955]/10 dark:hover:bg-[#8CD955]/10 hover:text-[#8CD955] dark:hover:text-[#8CD955]'
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
                </Link>
              );
            })}
          </div>
          
          {/* Voltar ao admin (quando está acessando conta de outro usuário) */}
          {isImpersonating && (
            <div className="mt-auto pt-4 pb-2 border-t border-gray-200 dark:border-[#404040]">
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
                style={{ backgroundColor: '#8CD955' }}
                title={isMobileOpen ? undefined : isCollapsed ? 'Voltar ao admin' : undefined}
              >
                <ArrowLeftToLine className="w-5 h-5 flex-shrink-0" />
                {(isMobileOpen || !isCollapsed) && (
                  <span className="font-medium whitespace-nowrap">Voltar ao admin</span>
                )}
              </button>
            </div>
          )}
          
          {/* Botão Sair no final da sidebar */}
          {shouldShowLogout && (
            <div className="mt-auto pt-4 pb-2 border-t border-gray-200 dark:border-[#404040]">
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
        </nav>
      </aside>
    </>
  );
};

export default Sidebar;
