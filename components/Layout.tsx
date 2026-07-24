'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import { useSidebar } from '@/contexts/SidebarContext';
import { Menu, X, LogOut } from 'lucide-react';
import Logo from './Logo';
import { getInternalAppPathname } from '@/lib/utils/white-label-path';

interface LayoutProps {
  children: React.ReactNode;
  onSignOut?: () => void;
}

const Layout: React.FC<LayoutProps> = ({ children, onSignOut }) => {
  const pathname = usePathname();
  const [sidebarWidth, setSidebarWidth] = useState(80);
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      if (!mobile) setIsMobileOpen(false);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, [setIsMobileOpen]);

  useEffect(() => {
    const updateSidebarWidth = () => {
      if (isMobile) {
        setSidebarWidth(0);
        return;
      }
      const sidebar = document.querySelector('aside[data-collapsed]');
      if (sidebar) {
        const isCollapsed = sidebar.getAttribute('data-collapsed') === 'true';
        setSidebarWidth(isCollapsed ? 80 : 256);
      }
    };

    updateSidebarWidth();
    const observer = new MutationObserver(updateSidebarWidth);
    const sidebar = document.querySelector('aside[data-collapsed]');
    if (sidebar) {
      observer.observe(sidebar, { attributes: true, attributeFilter: ['data-collapsed'] });
    }

    const interval = setInterval(updateSidebarWidth, 100);
    return () => {
      observer.disconnect();
      clearInterval(interval);
    };
  }, [isMobile]);

  // Heartbeat para rastrear tempo logado (Zaploto e CRM)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const sendHeartbeat = async () => {
      const id = sessionStorage.getItem('user_id') || localStorage.getItem('profile_id');
      if (!id) return;

      // Contabiliza total_crm_time em: crm/kanban, crm/transferido, demais /crm, /consultor e /gerente
      const isCrmPage =
        typeof pathname === 'string' &&
        (pathname.startsWith('/crm/kanban') ||
          pathname.startsWith('/crm/transferido') ||
          pathname.startsWith('/crm') ||
          pathname.startsWith('/consultor') ||
          pathname.startsWith('/gerente'));

      try {
        await fetch('/api/user/heartbeat', {
          method: 'POST',
          headers: { 'X-User-Id': id, 'Content-Type': 'application/json' },
          body: isCrmPage ? JSON.stringify({ context: 'crm' }) : undefined,
        });
      } catch (err) {
        // Ignora erros de heartbeat para não atrapalhar o usuário
      }
    };

    // Em página de CRM: envia heartbeat imediatamente para contabilizar tempo desde a entrada na página
    const isCrmPage =
      typeof pathname === 'string' &&
      (pathname.startsWith('/crm/kanban') ||
        pathname.startsWith('/crm/transferido') ||
        pathname.startsWith('/crm') ||
        pathname.startsWith('/consultor') ||
        pathname.startsWith('/gerente'));

    const initialTimeout = isCrmPage ? null : setTimeout(sendHeartbeat, 10000);
    if (isCrmPage) sendHeartbeat();

    const heartbeatInterval = setInterval(sendHeartbeat, 60000);
    return () => {
      if (initialTimeout) clearTimeout(initialTimeout);
      clearInterval(heartbeatInterval);
    };
  }, [pathname]);

  // Normaliza o pathname removendo o prefixo de tenant (`/zaploto/chat-atendimento` → `/chat-atendimento`),
  // senão o modo full-screen do chat e o editor de flows não ativam em tenants white label.
  const internalPath = getInternalAppPathname(pathname);
  const isChat = internalPath === '/chat' || internalPath === '/chat-atendimento';
  const isFlowEditor = /^\/admin\/flows\/[^/]+$/.test(internalPath);
  const isAntiSpamPage = internalPath.startsWith('/anti-spam');
  const isGestorTrafegoPage = internalPath.startsWith('/gestor-trafego');
  const isFullBleedPage = isAntiSpamPage || isGestorTrafegoPage;
  const isFullScreen = isChat || isFlowEditor;

  return (
    <div
      className={`app-bg-gradient flex flex-col lg:flex-row ${isFullScreen ? 'h-screen overflow-hidden' : 'min-h-screen'}`}
    >
      {/* Header Mobile — usa tokens do white label quando definidos */}
      <header
        className="lg:hidden h-16 border-b flex items-center justify-between px-4 sticky top-0 z-30 shadow-sm"
        style={{
          backgroundColor: 'var(--tenant-surface-elevated)',
          borderColor: 'var(--tenant-border)',
        }}
      >
        <div className="flex items-center gap-2">
          <Logo size="md" />
        </div>
        <button
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          className="p-2 rounded-xl bg-gray-50 dark:bg-[#333] text-gray-600 dark:text-[#ccc] hover:bg-gray-100 dark:hover:bg-[#404040] transition-colors"
          aria-label="Abrir menu"
        >
          {isMobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </header>

      <Sidebar onSignOut={onSignOut} />

      <main
        className={`flex-1 w-full transition-all duration-300 min-w-0 flex flex-col ${isFullScreen ? 'overflow-hidden' : 'min-h-screen'}`}
        style={{
          paddingLeft: isMobile ? '0px' : `${sidebarWidth}px`
        }}
      >
        {isFullScreen ? (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden w-full">
            {children}
          </div>
        ) : (
          <div
            className={
              isFullBleedPage
                ? 'w-full min-w-0 flex-1'
                : 'p-4 sm:p-6 lg:p-8'
            }
          >
            {children}
          </div>
        )}
      </main>

    </div>
  );
};

export default Layout;
