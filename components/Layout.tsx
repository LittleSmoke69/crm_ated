'use client';

import React, { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import { useSidebar } from '@/contexts/SidebarContext';
import { Menu, X, LogOut } from 'lucide-react';
import Logo from './Logo';
import TelefoneModal from './TelefoneModal';

interface LayoutProps {
  children: React.ReactNode;
  onSignOut?: () => void;
}

const Layout: React.FC<LayoutProps> = ({ children, onSignOut }) => {
  const [sidebarWidth, setSidebarWidth] = useState(80);
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();
  const [isMobile, setIsMobile] = useState(false);
  const [showTelefoneModal, setShowTelefoneModal] = useState(false);
  const [hasCheckedTelefone, setHasCheckedTelefone] = useState(false);

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

  // Verifica se usuário tem telefone cadastrado
  useEffect(() => {
    if (typeof window === 'undefined' || hasCheckedTelefone) return;

    const checkTelefone = async () => {
      const userId = sessionStorage.getItem('user_id') || 
                     sessionStorage.getItem('profile_id') || 
                     localStorage.getItem('profile_id');
      
      if (!userId) {
        setHasCheckedTelefone(true);
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
          if (result.success && result.data) {
            // Se não tem telefone, mostra o modal
            if (!result.data.telefone) {
              setShowTelefoneModal(true);
            }
          }
        }
      } catch (error) {
        console.error('Erro ao verificar telefone:', error);
      } finally {
        setHasCheckedTelefone(true);
      }
    };

    // Aguarda um pouco antes de verificar para não atrapalhar o carregamento inicial
    const timeout = setTimeout(checkTelefone, 1000);
    return () => clearTimeout(timeout);
  }, [hasCheckedTelefone]);

  // Heartbeat para rastrear tempo logado
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const sendHeartbeat = async () => {
      const id = sessionStorage.getItem('user_id') || localStorage.getItem('profile_id');
      if (!id) return;

      try {
        await fetch('/api/user/heartbeat', {
          method: 'POST',
          headers: { 'X-User-Id': id },
        });
      } catch (err) {
        // Ignora erros de heartbeat para não atrapalhar o usuário
      }
    };

    // Envia o primeiro heartbeat após 10s para confirmar que o usuário realmente entrou
    const initialTimeout = setTimeout(sendHeartbeat, 10000);
    
    // Envia heartbeats subsequentes a cada 60 segundos
    const heartbeatInterval = setInterval(sendHeartbeat, 60000);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(heartbeatInterval);
    };
  }, []);

  const handleSaveTelefone = async (telefone: string) => {
    const userId = sessionStorage.getItem('user_id') || 
                   sessionStorage.getItem('profile_id') || 
                   localStorage.getItem('profile_id');
    
    if (!userId) {
      throw new Error('Usuário não autenticado');
    }

    const response = await fetch('/api/user/telefone', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': userId,
      },
      credentials: 'include',
      body: JSON.stringify({ telefone }),
    });

    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || 'Erro ao salvar telefone');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col lg:flex-row">
      {/* Header Mobile */}
      <header className="lg:hidden h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 sticky top-0 z-30 shadow-sm">
        <div className="flex items-center gap-2">
          <Logo size="md" />
        </div>
        <button
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          className="p-2 rounded-xl bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors"
          aria-label="Abrir menu"
        >
          {isMobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </header>

      <Sidebar onSignOut={onSignOut} />
      
      <main
        className="flex-1 transition-all duration-300 min-h-screen min-w-0"
        style={{ 
          paddingLeft: isMobile ? '0px' : `${sidebarWidth}px` 
        }}
      >
        <div className="p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>

      {/* Modal de telefone */}
      <TelefoneModal
        isOpen={showTelefoneModal}
        onClose={() => setShowTelefoneModal(false)}
        onSave={handleSaveTelefone}
      />
    </div>
  );
};

export default Layout;
