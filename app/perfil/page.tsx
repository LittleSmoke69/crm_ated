'use client';

import React, { useEffect, useState } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Layout from '@/components/Layout';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/hooks/useToast';
import ToastContainer from '@/components/Toast/ToastContainer';
import { User, Mail, Phone, Building2, Shield, Loader2, Edit2, Save, X, Search, UserCircle, Sun, Moon, RefreshCw } from 'lucide-react';

interface BancaItem {
  id?: string;
  name: string;
  url: string | null;
}

interface GerenteInfo {
  id: string;
  email: string;
  full_name: string | null;
}

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  telefone: string | null;
  status: string | null;
  created_at: string;
  bancas: BancaItem[];
  gerente?: GerenteInfo | null;
  needs_bancas_choice?: boolean;
  theme_preference?: 'light' | 'dark';
}

const ROLES_COM_BANCAS = ['captador', 'gerente', 'super_admin'] as const;
/** Perfis que podem usar "Carregar bancas" (busca por email nas APIs das bancas). */
const ROLES_CARREGAR_BANCAS_POR_EMAIL = ['captador', 'gerente'] as const;

const PerfilPage = () => {
  const { checking, userId } = useRequireAuth();
  const { theme, setTheme } = useTheme();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTelefone, setEditingTelefone] = useState(false);
  const [telefoneValue, setTelefoneValue] = useState('');
  const [savingTelefone, setSavingTelefone] = useState(false);
  // Bancas: lista completa (para consultor/gerente) e seleção
  const [allBancas, setAllBancas] = useState<BancaItem[]>([]);
  const [selectedBancaIds, setSelectedBancaIds] = useState<Set<string>>(new Set());
  const [savingBancas, setSavingBancas] = useState(false);
  const [bancasLoaded, setBancasLoaded] = useState(false);
  const [modalBancasOpen, setModalBancasOpen] = useState(false);
  const [bancaSearchTerm, setBancaSearchTerm] = useState('');
  const [loadingLoadBancas, setLoadingLoadBancas] = useState(false);
  const [confirmLoadBancasOpen, setConfirmLoadBancasOpen] = useState(false);
  const { toasts, showToast, removeToast } = useToast();

  useEffect(() => {
    if (checking || !userId) return;

    const loadProfile = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/user/profile', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': userId,
          },
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error('Erro ao carregar perfil');
        }

        const result = await response.json();
        if (result.success) {
          setProfile(result.data);
          // Remove o prefixo 55 do telefone para exibição/edição
          const telefoneDisplay = result.data.telefone
            ? result.data.telefone.replace(/\D/g, '').startsWith('55')
              ? result.data.telefone.replace(/\D/g, '').slice(2)
              : result.data.telefone.replace(/\D/g, '')
            : '';
          setTelefoneValue(telefoneDisplay);
          // Força modo edição quando o usuário ainda não tem telefone
          if (!result.data.telefone) setEditingTelefone(true);
        } else {
          throw new Error(result.error || 'Erro ao carregar perfil');
        }
      } catch (err: any) {
        setError(err.message || 'Erro ao carregar perfil');
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [checking, userId]);

  // Carrega lista de bancas do banco (para exibição e modal)
  const loadBancasList = async () => {
    if (!userId) return;
    try {
      const res = await fetch('/api/crm/bancas', { headers: { 'X-User-Id': userId } });
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setAllBancas(data.data);
      }
      setBancasLoaded(true);
    } catch {
      setBancasLoaded(true);
    }
  };

  useEffect(() => {
    if (!userId || !profile) return;
    const canLoad = ROLES_COM_BANCAS.includes(profile.status as any) || profile.needs_bancas_choice === true;
    if (!canLoad) return;
    loadBancasList();
  }, [userId, profile?.status, profile?.needs_bancas_choice]);

  // Sincroniza seleção com as bancas do perfil (consultor/gerente/gestor/super_admin)
  useEffect(() => {
    if (!profile || !ROLES_COM_BANCAS.includes(profile.status as any) || !bancasLoaded) return;
    const ids = new Set<string>();
    profile.bancas.forEach((b) => {
      if (b.id) ids.add(b.id);
      else if (b.url) {
        const match = allBancas.find((a) => a.url === b.url);
        if (match?.id) ids.add(match.id);
      }
    });
    setSelectedBancaIds(ids);
  }, [profile?.bancas, profile?.status, bancasLoaded, allBancas]);

  const formatPhone = (phone: string | null): string => {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('55') && digits.length >= 13) {
      return `${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9, 13)}`;
    }
    return phone;
  };

  const handleSaveTelefone = async () => {
    const digitsOnly = telefoneValue.replace(/\D/g, '');
    
    if (!digitsOnly || digitsOnly.length < 10) {
      setError('Telefone inválido. Informe o DDD e o número (ex: 8195124779)');
      return;
    }

    try {
      setSavingTelefone(true);
      setError(null);

      const response = await fetch('/api/user/telefone', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId!,
        },
        credentials: 'include',
        body: JSON.stringify({ telefone: digitsOnly }),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Erro ao salvar telefone');
      }

      const result = await response.json();
      if (result.success && profile) {
        setProfile({ ...profile, telefone: result.data.telefone });
        setTelefoneValue(result.data.telefone ? result.data.telefone.replace(/\D/g, '').slice(2) : '');
        setEditingTelefone(false);
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar telefone');
    } finally {
      setSavingTelefone(false);
    }
  };

  const getStatusLabel = (status: string | null): string => {
    const labels: Record<string, string> = {
      super_admin: 'Super Admin',
      admin: 'Administrador',
      gerente: 'Gerente',
      captador: 'Captador',
    };
    return labels[status || ''] || status || 'Não definido';
  };

  const getStatusColor = (status: string | null): string => {
    const colors: Record<string, string> = {
      super_admin: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',
      admin: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
      gerente: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
      captador: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300',
    };
    return colors[status || ''] || 'bg-gray-100 dark:bg-gray-700/40 text-gray-700 dark:text-gray-300';
  };

  const canEditBancas = profile ? ROLES_COM_BANCAS.includes(profile.status as any) : false;
  const showBancasSection = canEditBancas || profile?.needs_bancas_choice === true;

  const toggleBanca = (bancaId: string) => {
    setSelectedBancaIds((prev) => {
      const next = new Set(prev);
      if (next.has(bancaId)) next.delete(bancaId);
      else next.add(bancaId);
      return next;
    });
  };

  const handleSaveBancas = async () => {
    if (!userId || !canEditBancas) return;
    try {
      setSavingBancas(true);
      setError(null);
      const response = await fetch('/api/user/bancas', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        credentials: 'include',
        body: JSON.stringify({ banca_ids: Array.from(selectedBancaIds) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Erro ao salvar bancas');
      if (profile) {
        const updatedBancas = allBancas.filter((b) => b.id && selectedBancaIds.has(b.id));
        setProfile({ ...profile, bancas: updatedBancas });
      }
      setModalBancasOpen(false);
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar bancas');
    } finally {
      setSavingBancas(false);
    }
  };

  const openModalBancas = () => {
    setError(null);
    if (!bancasLoaded) loadBancasList();
    setModalBancasOpen(true);
  };

  const handleLoadBancas = async () => {
    if (!userId || !profile) return;
    try {
      setLoadingLoadBancas(true);
      setError(null);
      const response = await fetch('/api/user/bancas/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        credentials: 'include',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Erro ao carregar bancas');
      if (result.success && result.data?.bancas) {
        setProfile({ ...profile, bancas: result.data.bancas });
        setAllBancas((prev) => {
          const byId = new Map(prev.map((b) => [b.id ?? '', b]));
          result.data.bancas.forEach((b: BancaItem) => {
            if (b.id && !byId.has(b.id)) byId.set(b.id, { id: b.id, name: b.name, url: b.url ?? null });
          });
          return Array.from(byId.values());
        });
        setBancasLoaded(true);
        setConfirmLoadBancasOpen(false);
        showToast('Atualização completa das suas bancas', 'success');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar bancas');
      setConfirmLoadBancasOpen(false);
    } finally {
      setLoadingLoadBancas(false);
    }
  };

  const closeModalBancas = () => {
    if (!savingBancas) {
      setError(null);
      setBancaSearchTerm('');
      setModalBancasOpen(false);
    }
  };

  const filteredBancasModal = allBancas.filter(
    (b) =>
      !bancaSearchTerm.trim() ||
      b.name.toLowerCase().includes(bancaSearchTerm.toLowerCase().trim()) ||
      (b.url && b.url.toLowerCase().includes(bancaSearchTerm.toLowerCase().trim()))
  );

  if (checking || loading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-[#E86A24] mx-auto mb-4" />
            <p className="text-gray-600">Carregando perfil...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (error && !profile) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-600 mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-[#E86A24] text-white rounded-xl hover:bg-[#D95E1B] transition-colors"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  if (!profile) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <p className="text-gray-600">Perfil não encontrado</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Meu Perfil</h1>
          <p className="text-gray-600 dark:text-[#aaa]">Visualize e gerencie suas informações pessoais</p>
        </div>

        {/* Card Principal */}
        <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-lg border border-gray-200 dark:border-[#404040] overflow-hidden">
          {/* Header do Card */}
          <div className="bg-gradient-to-r from-[#EF9057] to-[#E86A24] p-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center">
                <User className="w-8 h-8 text-[#E86A24]" />
              </div>
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-white mb-1">
                  {profile.full_name || 'Sem nome'}
                </h2>
                <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(profile.status)}`}>
                  {getStatusLabel(profile.status)}
                </span>
              </div>
            </div>
          </div>

          {/* Conteúdo do Card */}
          <div className="p-6 space-y-6">
            {/* Email */}
            <div className="flex items-start gap-4 p-4 bg-gray-50 dark:bg-[#333] rounded-xl">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                <Mail className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-500 dark:text-[#aaa] mb-1">Email</label>
                <p className="text-gray-900 dark:text-white font-medium">{profile.email}</p>
              </div>
            </div>

            {/* Telefone */}
            <div className="flex items-start gap-4 p-4 bg-gray-50 dark:bg-[#333] rounded-xl">
              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                <Phone className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-500 dark:text-[#aaa] mb-1">Telefone</label>
                {editingTelefone ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="tel"
                      value={telefoneValue.replace(/\D/g, '').slice(0, 11)}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, '').slice(0, 11);
                        setTelefoneValue(digits);
                      }}
                      placeholder="8195124779"
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-[#E86A24] dark:focus:ring-[#E86A24] focus:border-transparent outline-none placeholder:text-gray-400 dark:placeholder:text-[#888]"
                      autoFocus
                      inputMode="numeric"
                      pattern="[0-9]*"
                    />
                    <button
                      onClick={handleSaveTelefone}
                      disabled={savingTelefone}
                      className="p-2 bg-[#E86A24] text-white rounded-lg hover:bg-[#D95E1B] transition-colors disabled:opacity-50"
                      title="Salvar"
                    >
                      {savingTelefone ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <p className="text-gray-900 dark:text-white font-medium">
                      {profile.telefone ? formatPhone(profile.telefone) : 'Não cadastrado'}
                    </p>
                    <button
                      onClick={() => setEditingTelefone(true)}
                      className="p-2 text-[#E86A24] dark:text-[#EF9057] hover:bg-green-50 dark:hover:bg-[#E86A2415] rounded-lg transition-colors"
                      title="Editar telefone"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
                {error && editingTelefone && (
                  <p className="mt-2 text-sm text-red-600">{error}</p>
                )}
              </div>
            </div>

            {/* Meu gerente (captador) */}
            {profile.status === 'captador' && profile.gerente && (
              <div className="flex items-start gap-4 p-4 bg-gray-50 dark:bg-[#333] rounded-xl">
                <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                  <UserCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <label className="block text-sm font-medium text-gray-500 dark:text-[#aaa] mb-1">Meu gerente</label>
                  <p className="text-gray-900 dark:text-white font-medium">{profile.gerente.full_name || profile.gerente.email}</p>
                  {profile.gerente.email && (
                    <p className="text-sm text-gray-500 dark:text-[#888]">{profile.gerente.email}</p>
                  )}
                </div>
              </div>
            )}

            {/* Bancas (consultor, gerente, gestor, super_admin ou quando precisa escolher) */}
            {showBancasSection && (
            <div className="flex items-start gap-4 p-4 bg-gray-50 dark:bg-[#333] rounded-xl">
              <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                <Building2 className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="flex-1 min-w-0">
                <label className="block text-sm font-medium text-gray-500 dark:text-[#aaa] mb-2">
                  {canEditBancas || profile.needs_bancas_choice ? 'Bancas em que atuo' : profile.bancas.length === 1 ? 'Banca' : 'Bancas'}
                </label>
                {(canEditBancas || profile.needs_bancas_choice) ? (
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      {profile.bancas.length > 0 ? (
                        <p className="text-gray-900 dark:text-white font-medium">
                          {profile.bancas.map((b) => b.name).join(', ')}
                        </p>
                      ) : (
                        <p className="text-gray-500 dark:text-[#888]">Nenhuma banca associada</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {ROLES_CARREGAR_BANCAS_POR_EMAIL.includes(profile.status as any) && (
                        <button
                          type="button"
                          onClick={() => setConfirmLoadBancasOpen(true)}
                          disabled={loadingLoadBancas}
                          className="flex items-center gap-2 px-3 py-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors font-medium disabled:opacity-50"
                          title="Buscar e salvar bancas em que você atua (por email)"
                        >
                          {loadingLoadBancas ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <RefreshCw className="w-4 h-4" />
                          )}
                          Carregar bancas
                        </button>
                      )}
                    </div>
                    {error && !editingTelefone && (
                      <p className="text-sm text-red-600 dark:text-red-400 mt-2 w-full">{error}</p>
                    )}
                  </div>
                ) : (
                  <>
                    {profile.bancas.length > 0 ? (
                      <div className="space-y-2">
                        {profile.bancas.map((banca, index) => (
                          <div key={banca.id || index} className="flex items-center gap-2">
                            <span className="text-gray-900 dark:text-white font-medium">{banca.name}</span>
                            {banca.url && (
                              <a
                                href={banca.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#E86A24] dark:text-[#EF9057] hover:underline text-sm"
                              >
                                ({banca.url})
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-500">Nenhuma banca associada</p>
                    )}
                  </>
                )}
              </div>
            </div>
            )}

            {/* Modal de confirmação — Carregar bancas */}
            {confirmLoadBancasOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => !loadingLoadBancas && setConfirmLoadBancasOpen(false)}>
                <div
                  className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-xl max-w-md w-full border border-gray-200 dark:border-[#404040] p-6"
                  onClick={(e) => e.stopPropagation()}
                >
                  {loadingLoadBancas ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-4">
                      <Loader2 className="w-12 h-12 animate-spin text-[#E86A24] dark:text-[#EF9057]" />
                      <p className="text-gray-700 dark:text-gray-300 font-medium text-center">Estamos realizando a atualização das suas bancas.</p>
                      <p className="text-gray-500 dark:text-[#888] text-sm text-center">Isso pode levar alguns segundos. Aguarde...</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-xl">
                          <RefreshCw className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">Atualizar bancas em que atuo</h3>
                      </div>
                      <p className="text-gray-600 dark:text-[#aaa] text-sm mb-6">
                        Será feita uma busca em todas as bancas cadastradas usando seu e-mail. As bancas em que você estiver cadastrado serão atualizadas e salvas no seu perfil, substituindo a lista atual. Isso pode levar alguns segundos.
                      </p>
                      <p className="text-gray-700 dark:text-gray-300 font-medium mb-6">Deseja realmente realizar a atualização das bancas em que você atua?</p>
                      <div className="flex gap-3 justify-end">
                        <button
                          type="button"
                          onClick={() => setConfirmLoadBancasOpen(false)}
                          className="px-4 py-2.5 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-[#404040] hover:bg-gray-200 dark:hover:bg-[#4a4a4a] rounded-xl font-medium transition-colors"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleLoadBancas()}
                          className="flex items-center gap-2 px-4 py-2.5 bg-[#E86A24] dark:bg-[#E86A24] text-white hover:bg-[#D95E1B] dark:hover:bg-[#D95E1B] rounded-xl font-medium transition-colors"
                        >
                          Sim, atualizar
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Modal de seleção de bancas */}
            {modalBancasOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={closeModalBancas}>
                <div
                  className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col overflow-hidden border border-gray-200 dark:border-[#404040]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="p-4 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between shrink-0">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">Bancas em que atuo</h3>
                    <button
                      type="button"
                      onClick={closeModalBancas}
                      className="p-2 text-gray-500 dark:text-[#aaa] hover:bg-gray-100 dark:hover:bg-[#333] rounded-lg transition-colors"
                      aria-label="Fechar"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#2a2a2a]">
                    {bancasLoaded && allBancas.length > 0 && (
                      <div className="p-4 pt-0 shrink-0">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                          <input
                            type="search"
                            value={bancaSearchTerm}
                            onChange={(e) => setBancaSearchTerm(e.target.value)}
                            placeholder="Pesquisar banca por nome ou URL..."
                            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 dark:border-[#555] rounded-xl bg-gray-100 dark:bg-[#333] focus:bg-gray-50 dark:focus:bg-[#3a3a3a] focus:ring-2 focus:ring-[#E86A24] dark:focus:ring-[#E86A24] focus:border-[#E86A24] dark:focus:border-[#E86A24] outline-none text-gray-900 dark:text-white placeholder:text-gray-600 dark:placeholder:text-[#888]"
                          />
                        </div>
                      </div>
                    )}
                    <div className="p-4 overflow-y-auto flex-1 min-h-0">
                      {!bancasLoaded ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-8 h-8 animate-spin text-[#E86A24]" />
                          <span className="ml-2 text-gray-600 dark:text-gray-300">Carregando bancas...</span>
                        </div>
                      ) : allBancas.length === 0 ? (
                        <p className="text-gray-500 dark:text-gray-400 py-4">Nenhuma banca cadastrada no sistema. Peça ao administrador para cadastrar bancas.</p>
                      ) : (
                        <div className="space-y-2">
                          {filteredBancasModal.length === 0 ? (
                            <p className="text-gray-600 dark:text-gray-400 py-4">Nenhuma banca encontrada para &quot;{bancaSearchTerm}&quot;</p>
                          ) : (
                            filteredBancasModal.map((banca) => (
                              <label
                                key={banca.id ?? ''}
                                className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-[#333] rounded-lg p-3 border border-gray-100 dark:border-[#404040]"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedBancaIds.has(banca.id ?? '')}
                                  onChange={() => toggleBanca(banca.id ?? '')}
                                  className="w-4 h-4 rounded border-gray-300 dark:border-[#555] text-[#E86A24] dark:text-[#EF9057] focus:ring-[#E86A24] dark:focus:ring-[#E86A24]"
                                />
                                <span className="text-gray-900 dark:text-white font-medium">{banca.name}</span>
                                {banca.url && (
                                  <span className="text-gray-400 dark:text-[#888] text-sm truncate max-w-[180px]" title={banca.url}>
                                    {banca.url}
                                  </span>
                                )}
                              </label>
                            ))
                          )}
                        </div>
                      )}
                      {error && (
                        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
                      )}
                    </div>
                  </div>
                  <div className="p-4 border-t border-gray-200 dark:border-[#404040] flex justify-end gap-2 shrink-0 bg-white dark:bg-[#2a2a2a]">
                    <button
                      type="button"
                      onClick={closeModalBancas}
                      className="px-4 py-2 text-gray-700 dark:text-[#ccc] bg-gray-100 dark:bg-[#404040] hover:bg-gray-200 dark:hover:bg-[#4a4a4a] rounded-xl font-medium transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveBancas}
                      disabled={savingBancas || !bancasLoaded || allBancas.length === 0}
                      className="flex items-center gap-2 px-4 py-2 bg-[#E86A24] dark:bg-[#E86A24] text-white rounded-xl hover:bg-[#D95E1B] dark:hover:bg-[#D95E1B] transition-colors disabled:opacity-50 font-medium"
                    >
                      {savingBancas ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Salvando...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          Salvar
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Tema (Light / Dark) */}
            <div className="flex items-start gap-4 p-4 bg-gray-50 dark:bg-[#333] rounded-xl">
              <div className="p-2 bg-gray-100 dark:bg-[#404040] rounded-lg">
                <Sun className="w-5 h-5 text-gray-600 dark:text-[#EF9057]" />
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-500 dark:text-[#aaa] mb-2">Aparência</label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setTheme('light')}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-all ${
                      theme === 'light'
                        ? 'bg-[#E86A24] dark:bg-[#E86A24] text-white shadow-md'
                        : 'bg-gray-200 dark:bg-[#404040] text-gray-700 dark:text-[#ccc] hover:bg-gray-300 dark:hover:bg-[#4a4a4a]'
                    }`}
                  >
                    <Sun className="w-4 h-4" />
                    Modo claro (White)
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme('dark')}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-all ${
                      theme === 'dark'
                        ? 'bg-[#E86A24] dark:bg-[#E86A24] text-white shadow-md'
                        : 'bg-gray-200 dark:bg-[#404040] text-gray-700 dark:text-[#ccc] hover:bg-gray-300 dark:hover:bg-[#4a4a4a]'
                    }`}
                  >
                    <Moon className="w-4 h-4" />
                    Modo escuro (Dark)
                  </button>
                </div>
              </div>
            </div>

            {/* Data de criação */}
            <div className="flex items-start gap-4 p-4 bg-gray-50 dark:bg-[#333] rounded-xl">
              <div className="p-2 bg-gray-100 dark:bg-[#404040] rounded-lg">
                <Shield className="w-5 h-5 text-gray-600 dark:text-[#aaa]" />
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-500 dark:text-[#aaa] mb-1">Membro desde</label>
                <p className="text-gray-900 dark:text-white font-medium">
                  {new Date(profile.created_at).toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </Layout>
  );
};

export default PerfilPage;
