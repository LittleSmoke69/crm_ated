'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import { useSidebar } from '@/contexts/SidebarContext';
import { Menu, X, LogOut } from 'lucide-react';
import Logo from './Logo';
import BancasModal from './BancasModal';
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
  const [showBancasModal, setShowBancasModal] = useState(false);
  const [hasCheckedProfile, setHasCheckedProfile] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userStatus, setUserStatus] = useState<'consultor' | 'gerente' | 'gestor' | 'super_admin' | null>(null);

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

  // Verifica se usuário precisa escolher bancas (consultor/gerente/gestor)
  useEffect(() => {
    if (typeof window === 'undefined' || hasCheckedProfile) return;

    const checkProfile = async () => {
      const uid =
        sessionStorage.getItem('user_id') ||
        sessionStorage.getItem('profile_id') ||
        localStorage.getItem('profile_id');

      if (!uid) {
        setHasCheckedProfile(true);
        return;
      }

      try {
        const response = await fetch('/api/user/profile', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': uid },
          credentials: 'include',
        });

        if (response.ok) {
          const text = await response.text();
          let result: { success?: boolean; data?: { status?: string; needs_bancas_choice?: boolean; bancas?: unknown[] } } = {};
          if (text.trim()) {
            try {
              result = JSON.parse(text);
            } catch {
              setHasCheckedProfile(true);
              return;
            }
          }
          if (result.success && result.data) {
            const d = result.data;
            setUserId(uid);
            const canSeeBancasModal = !!(d.status && ['consultor', 'gerente', 'gestor'].includes(d.status));
            if (canSeeBancasModal) {
              setUserStatus(d.status as 'consultor' | 'gerente' | 'gestor' | 'super_admin');
            }

            if (
              canSeeBancasModal &&
              (d.needs_bancas_choice === true || (Array.isArray(d.bancas) && d.bancas.length === 0))
            ) {
              setShowBancasModal(true);
            }
          }
        }
      } catch (error) {
        console.error('Erro ao verificar perfil:', error);
      } finally {
        setHasCheckedProfile(true);
      }
    };

    checkProfile();
  }, [hasCheckedProfile]);

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

  const handleSaveBancas = async (bancaIds: string[]) => {
    if (!userId) {
      console.warn('[handleSaveBancas] Tentativa de salvar sem userId');
      throw new Error('Usuário não autenticado');
    }

    console.log('[handleSaveBancas] Iniciando salvamento de bancas:', { userId, bancaIds });

    try {
      const response = await fetch('/api/user/bancas', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        credentials: 'include',
        body: JSON.stringify({ banca_ids: bancaIds }),
      });

      console.log('[handleSaveBancas] Resposta recebida:', {
        status: response.status,
        ok: response.ok,
        statusText: response.statusText
      });

      if (!response.ok) {
        const text = await response.text();
        console.error('[handleSaveBancas] Erro na resposta da API:', text);

        let result: { error?: string } = {};
        if (text.trim()) {
          try {
            result = JSON.parse(text);
          } catch (e) {
            console.error('[handleSaveBancas] Falha ao parsear erro JSON:', e);
          }
        }
        throw new Error(result.error || `Erro ${response.status}: ${response.statusText}`);
      }

      console.log('[handleSaveBancas] Bancas salvas com sucesso!');
      setShowBancasModal(false);
    } catch (error: any) {
      console.error('[handleSaveBancas] Exceção capturada:', error);
      throw error;
    }
  };

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

      {/* Modal de bancas (consultor/gerente/gestor) */}
      {showBancasModal && userId && (
        <BancasModal
          isOpen={showBancasModal}
          onClose={() => setShowBancasModal(false)}
          onSave={handleSaveBancas}
          userStatus={userStatus || 'consultor'}
          userId={userId}
        />
      )}
    </div>
  );
};

export default Layout;
