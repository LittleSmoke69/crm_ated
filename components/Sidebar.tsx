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

type UserStatus = 'super_admin' | 'admin' | 'consultor' | 'gerente' | 'dono_banca' | 'auditoria' | 'suporte' | null;

const Sidebar: React.FC<SidebarProps> = ({ onSignOut }) => {
  const pathname = usePathname();
  const router = useRouter();
  const { isMobileOpen, setIsMobileOpen, isCollapsed, setIsCollapsed } = useSidebar();
  const [userStatus, setUserStatus] = useState<UserStatus>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const [loadingRoute, setLoadingRoute] = useState<string | null>(null);

  // Verifica se está nas páginas que devem mostrar o botão Sair
  const shouldShowLogout = pathname === '/perfil' || 
                          pathname === '/list-cleaning' ||
                          pathname?.startsWith('/admin/webhooks') ||
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

  useEffect(() => {
    const loadUserProfile = async () => {
      if (typeof window === 'undefined') return;
      
      const userId = sessionStorage.getItem('user_id') || 
                     sessionStorage.getItem('profile_id') || 
                     window.localStorage.getItem('profile_id');
      
      if (!userId) {
        setUserStatus(null);
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
          const result = await response.json();
          if (result.success && result.data?.status) {
            setUserStatus(result.data.status as UserStatus);
          }
        }
      } catch (error) {
        console.error('Erro ao carregar perfil:', error);
        setUserStatus(null);
      }
    };

    loadUserProfile();
  }, []);

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
    label: 'Webhooks',
    icon: Webhook,
    submenu: [
      { href: '/admin/webhooks/evolution', icon: Webhook, label: 'Eventos' },
      { href: '/admin/webhooks/normalization-rules', icon: Settings, label: 'Regras de Normalização' },
    ],
  };
  const itemFlows: MenuItem = { href: '/admin/flows', icon: Workflow, label: 'Flows (Automações)' };
  const itemAgentesIAAdmin: MenuItem = { href: '/admin/ai-agents', icon: Bot, label: 'Agentes IA' };
  const itemAgentesIA: MenuItem = { href: '/ai-agents', icon: Bot, label: 'Agentes IA' };
  const itemChatInterno: MenuItem = { href: '/chat', icon: MessageSquare, label: 'Chat Interno' };
  const itemCRM: MenuItem = {
    label: 'CRM',
    icon: Layout,
    submenu: [{ href: '/crm/kanban', icon: Kanban, label: 'Kanban' }],
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
  // Consultor: apenas Campanha > Grupos
  const itemCampanhaConsultor: MenuItem = {
    label: 'Campanha',
    icon: Rocket,
    submenu: [{ href: '/campanha/groups', icon: Users, label: 'Grupos' }],
  };
  const itemContatosAtivos: MenuItem = { href: '/contacts', icon: Users, label: 'Contatos Ativos' };
  const itemImportarContatos: MenuItem = { href: '/import-contacts', icon: Plus, label: 'Importar Contatos' };
  const itemLimpezaLista: MenuItem = { href: '/list-cleaning', icon: ListOrdered, label: 'Limpeza de Lista' };
  const itemAuditoria: MenuItem = { href: '/admin/audit', icon: ClipboardList, label: 'Auditoria' };
  const itemAntiSpam: MenuItem = { href: '/anti-spam', icon: Shield, label: 'Anti-Spam' };
  const itemGestaoBanca: MenuItem = { href: '/dono-banca', icon: BarChart3, label: 'Gestão de Banca' };
  const itemGestaoConsultores: MenuItem = { href: '/gerente', icon: Briefcase, label: 'Gestão de Consultores' };
  const itemMeuDesempenho: MenuItem = { href: '/consultor', icon: BarChart3, label: 'Meu Desempenho' };

  // Define menus baseados no status do usuário (matriz de cargos)
  const getMenuItems = (): MenuItem[] => {
    // 👑 SuperAdmin - vê tudo
    if (userStatus === 'super_admin') {
      return [
        itemDashboard,
        itemInstances,
        itemMaturador,
        itemPainelAdmin,
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
        itemGestaoConsultores,
      ];
    }

    // 🛠️ Admin - painel, CRM, campanhas, instâncias (sem Gestão Consultores/Banca, Anti-Spam, Auditoria, Chat Interno, Maturador)
    if (userStatus === 'admin') {
      return [
        itemDashboard,
        itemInstances,
        itemPainelAdmin,
        itemAgentesIAAdmin,
        itemCRM,
        itemCampanhas,
        itemContatosAtivos,
        itemImportarContatos,
        itemLimpezaLista,
        itemProfile,
      ];
    }

    // 🎧 Suporte - atendimento e operação (sem Flows, Webhooks, Auditoria, Anti-Spam, Gestão)
    if (userStatus === 'suporte') {
      return [
        itemDashboard,
        itemInstances,
        itemMaturador,
        itemAgentesIA,
        itemChatInterno,
        itemCRM,
        itemCampanhas,
        itemContatosAtivos,
        itemImportarContatos,
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
        itemCRM,
        itemCampanhas,
        itemContatosAtivos,
        itemImportarContatos,
        itemAuditoria,
        itemAntiSpam,
        itemProfile,
      ];
    }

    // 💰 Dono de Banca - Gestão de Banca + operação (sem Flows, Webhooks, Auditoria, Anti-Spam, Chat, Gestão Consultores)
    if (userStatus === 'dono_banca') {
      return [
        itemGestaoBanca,
        itemDashboard,
        itemInstances,
        itemMaturador,
        itemAgentesIA,
        itemCRM,
        itemCampanhas,
        itemContatosAtivos,
        itemImportarContatos,
        itemProfile,
      ];
    }

    // 📊 Gerente - Gestão de Consultores + operação (sem Maturador, Flows, Webhooks, Auditoria, Anti-Spam, Chat, Gestão Banca)
    if (userStatus === 'gerente') {
      return [
        itemGestaoConsultores,
        itemDashboard,
        itemInstances,
        itemAgentesIA,
        itemCRM,
        itemCampanhas,
        itemContatosAtivos,
        itemImportarContatos,
        itemProfile,
      ];
    }

    // 👨‍💼 Consultor - operacional (Meu Desempenho, Instâncias, CRM, Campanha > Grupos, Agentes IA, Meu Perfil)
    if (userStatus === 'consultor') {
      return [
        itemMeuDesempenho,
        itemInstances,
        itemCRM,
        itemCampanhaConsultor,
        itemAgentesIA,
        itemProfile,
      ];
    }

    // Fallback - status ainda não carregou ou desconhecido
    return [
      itemDashboard,
      itemInstances,
      itemMaturador,
      itemProfile,
    ];
  };

  const menuItems = getMenuItems();

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
          className="lg:hidden fixed inset-0 bg-white/70 backdrop-blur-[1px] z-40"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed left-0 top-0 h-full bg-gray-100 shadow-lg z-40
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
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          {(isMobileOpen || !isCollapsed) && (
            <Logo size="lg" />
          )}
          {/* Botão X no mobile para fechar a sidebar */}
          {isMobileOpen && (
            <button
              onClick={() => setIsMobileOpen(false)}
              className="lg:hidden flex items-center justify-center w-9 h-9 rounded-lg hover:bg-gray-100 transition text-gray-600"
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
            className="hidden lg:flex items-center justify-center w-8 h-8 rounded-lg hover:bg-gray-100 transition text-gray-600"
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
                            : 'text-gray-700 hover:bg-[#8CD95515] hover:text-[#8CD955]'
                        }
                      `}
                      style={active && !isExpanded ? { backgroundColor: '#8CD955' } : {}}
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
                          const subActive = isActive(sub.href);
                          return (
                            <Link
                              key={sub.href}
                              href={sub.href}
                              onClick={() => {
                                if (window.innerWidth < 1024) {
                                  setIsMobileOpen(false);
                                }
                              }}
                              className={`
                                flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200
                                ${subActive ? 'font-semibold' : 'text-gray-600 hover:bg-[#8CD95515] hover:text-[#8CD955]'}
                              `}
                              style={subActive ? { 
                                color: '#8CD955', 
                                backgroundColor: '#8CD95515' 
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

              // Verifica se é o link "Métricas da Banca" e está carregando
              const isDonoBancaLink = item.href === '/dono-banca';
              const isLoadingDonoBanca = loadingRoute === '/dono-banca';

              return (
                <Link
                  key={item.href || item.label}
                  href={item.href || '#'}
                  onClick={(e) => {
                    if (window.innerWidth < 1024) {
                      setIsMobileOpen(false);
                    }
                    // Se for o link "Métricas da Banca", ativa o loading
                    if (isDonoBancaLink && item.href) {
                      setLoadingRoute(item.href);
                      // Limpa o loading após um tempo (fallback caso a navegação não ocorra)
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
                        : 'text-gray-700 hover:bg-[#8CD95515] hover:text-[#8CD955]'
                    }
                    ${isLoadingDonoBanca ? 'opacity-75 cursor-wait' : ''}
                  `}
                  style={active ? { backgroundColor: '#8CD955' } : {}}
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
          
          {/* Botão Sair no final da sidebar */}
          {shouldShowLogout && (
            <div className="mt-auto pt-4 pb-2 border-t border-gray-200">
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
