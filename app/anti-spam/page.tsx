'use client';

import React, { useState, useEffect } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Shield, Menu, AlertCircle, Info } from 'lucide-react';
import { useSidebar } from '@/contexts/SidebarContext';

const AntiSpamPage = () => {
  const { checking, userId } = useRequireAuth();
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();

  useEffect(() => {
    // Anti-Spam: acessível para super_admin, admin e auditoria
    const checkUserStatus = async () => {
      if (!userId) return;
      const allowedStatuses = ['super_admin', 'admin', 'auditoria'];
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
          const status = result.success ? result.data?.status : null;
          if (!status || !allowedStatuses.includes(status)) {
            window.location.href = '/';
          }
        }
      } catch (error) {
        console.error('Erro ao verificar status do usuário:', error);
      }
    };

    checkUserStatus();
  }, [userId]);

  const handleSignOut = async () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
      window.location.href = '/login';
    }
  };

  if (checking || !userId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200 text-center">
          <p className="text-gray-700 font-medium">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <Layout onSignOut={handleSignOut}>
      <div className="space-y-6 w-full">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">Anti-Spam</h1>
            <p className="text-sm sm:text-base text-gray-600">Gerenciamento de proteção contra spam</p>
          </div>
          <div className="lg:hidden flex-shrink-0">
            <button
              onClick={() => setIsMobileOpen(!isMobileOpen)}
              className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-gray-100 transition text-gray-600 shadow-md bg-white"
              aria-label="Toggle sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Placeholder */}
        <div className="bg-gray-100 rounded-xl shadow-md p-6 border border-gray-200">
          <div className="text-center py-12">
            <Shield className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-800 mb-2">Funcionalidade em Desenvolvimento</h2>
            <p className="text-gray-500 mb-4">
              A funcionalidade de Anti-Spam está sendo desenvolvida e estará disponível em breve.
            </p>
            <div className="bg-blue-50 border border-blue-200 text-blue-800 p-4 rounded-lg inline-block">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div className="text-left">
                  <p className="font-semibold mb-1">O que será incluído:</p>
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    <li>Detecção automática de spam</li>
                    <li>Regras de filtragem personalizadas</li>
                    <li>Relatórios de tentativas de spam</li>
                    <li>Configurações de bloqueio</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default AntiSpamPage;

