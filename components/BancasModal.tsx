'use client';

import React, { useState, useEffect } from 'react';
import { Building2, AlertCircle, Check, ChevronUp, ChevronDown, Search } from 'lucide-react';

interface BancaItem {
  id: string;
  name: string;
  url?: string | null;
}

interface BancasModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (bancaIds: string[]) => Promise<void>;
  userStatus: 'consultor' | 'gerente' | 'gestor' | 'super_admin';
  userId: string | null;
}

/**
 * Modal obrigatório: gerente e consultor precisam escolher ao menos uma banca e definir a ordem de prioridade.
 * Estilo alinhado ao TelefoneModal; bancas carregadas do banco; hierarquia = ordem da lista.
 */
const BancasModal: React.FC<BancasModalProps> = ({
  isOpen,
  onClose,
  onSave,
  userStatus,
  userId,
}) => {
  const [bancas, setBancas] = useState<BancaItem[]>([]);
  /** Ordem dos IDs selecionados = hierarquia (1º = principal, 2º = secundária, etc.) */
  const [selectedOrder, setSelectedOrder] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingBancas, setLoadingBancas] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && userId) {
      setError(null);
      setLoadingBancas(true);
      fetch('/api/crm/bancas?ignoreFilter=true', {
        headers: { 'X-User-Id': userId },
        credentials: 'include',
      })
        .then(async (res) => {
          const text = await res.text();
          if (!text.trim()) return { success: false, data: [] };
          try {
            return JSON.parse(text) as { success?: boolean; data?: BancaItem[] };
          } catch {
            return { success: false, data: [] };
          }
        })
        .then((data) => {
          if (data.success && Array.isArray(data.data)) {
            setBancas(data.data.filter((b: BancaItem) => b.id));
          } else {
            setBancas([]);
          }
        })
        .catch(() => setBancas([]))
        .finally(() => setLoadingBancas(false));
    } else if (!isOpen) {
      setSelectedOrder([]);
      setSearchTerm('');
      setError(null);
    }
  }, [isOpen, userId]);

  const selectedSet = new Set(selectedOrder);

  const filteredBancas = searchTerm.trim()
    ? bancas.filter(
      (b) =>
        (b.name && b.name.toLowerCase().includes(searchTerm.toLowerCase().trim())) ||
        (b.url && b.url.toLowerCase().includes(searchTerm.toLowerCase().trim()))
    )
    : bancas;

  const handleToggle = (id: string) => {
    setSelectedOrder((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return [...prev, id];
    });
  };

  const moveUp = (index: number) => {
    if (index <= 0) return;
    setSelectedOrder((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  };

  const moveDown = (index: number) => {
    if (index < 0 || index >= selectedOrder.length - 1) return;
    setSelectedOrder((prev) => {
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (selectedOrder.length === 0) {
      setError('Selecione pelo menos uma banca');
      return;
    }

    try {
      setLoading(true);
      await onSave(selectedOrder);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar bancas. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const title =
    userStatus === 'consultor'
      ? 'Escolha as bancas em que você trabalha'
      : 'Escolha a(s) banca(s) em que você trabalha';

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      style={{ pointerEvents: 'auto' }}
    >
      <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] flex flex-col relative animate-in fade-in zoom-in duration-200 border border-gray-200 dark:border-[#404040]">
        {/* Header - mesmo padrão do TelefoneModal */}
        <div className="p-6 pb-0 flex-shrink-0">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-3 bg-[#E86A24] dark:bg-[#00ff00] bg-opacity-10 dark:bg-opacity-20 rounded-xl">
              <Building2 className="w-6 h-6 text-[#E86A24] dark:text-[#00ff00]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{title}</h2>
              <p className="text-sm text-gray-500 dark:text-[#aaa]">Obrigatório para continuar no Zaploto</p>
            </div>
          </div>
        </div>

        {/* Mensagem explicativa - estilo TelefoneModal */}
        <div className="px-6 py-4">
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-800 dark:text-blue-300">
                <p className="font-semibold mb-1">Por que escolher minhas bancas?</p>
                <p className="text-blue-700 dark:text-blue-300">
                  Selecione uma ou mais bancas em que você atua e defina a ordem de prioridade (a primeira da lista é a principal).
                </p>
              </div>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="px-6 overflow-y-auto flex-1 space-y-4">
            {loadingBancas ? (
              <p className="text-gray-500 dark:text-[#aaa] text-sm">Carregando bancas...</p>
            ) : bancas.length === 0 ? (
              <p className="text-gray-500 dark:text-[#aaa] text-sm">Nenhuma banca disponível no momento.</p>
            ) : (
              <>
                <div className="mb-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-[#888] pointer-events-none" />
                    <input
                      type="search"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Pesquisar banca por nome ou URL..."
                      className="w-full pl-9 pr-4 py-2.5 border border-gray-200 dark:border-[#555] rounded-xl bg-gray-50 dark:bg-[#333] focus:bg-white dark:focus:bg-[#3a3a3a] focus:ring-2 focus:ring-[#E86A24] dark:focus:ring-[#00ff00] focus:border-[#E86A24] dark:focus:border-[#00ff00] outline-none text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-[#888]"
                      aria-label="Pesquisar banca"
                    />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-[#ccc] mb-2">Bancas disponíveis</p>
                  <ul className="space-y-2">
                    {filteredBancas.length === 0 ? (
                      <p className="text-gray-500 dark:text-[#aaa] text-sm py-3">
                        {searchTerm.trim() ? `Nenhuma banca encontrada para "${searchTerm.trim()}"` : 'Nenhuma banca disponível.'}
                      </p>
                    ) : (
                      filteredBancas.map((b) => (
                        <li key={b.id}>
                          <label className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-[#404040] hover:bg-gray-50 dark:hover:bg-[#333] cursor-pointer transition-colors">
                            <input
                              type="checkbox"
                              checked={selectedSet.has(b.id)}
                              onChange={() => handleToggle(b.id)}
                              className="w-5 h-5 rounded border-gray-300 dark:border-[#555] text-[#E86A24] dark:text-[#00ff00] focus:ring-[#E86A24] dark:focus:ring-[#00ff00]"
                            />
                            <span className="flex-1 font-medium text-gray-900 dark:text-white">
                              {b.name || b.url || b.id}
                            </span>
                            {selectedSet.has(b.id) && (
                              <Check className="w-5 h-5 text-[#E86A24] dark:text-[#00ff00]" />
                            )}
                          </label>
                        </li>
                      ))
                    )}
                  </ul>
                </div>

                {selectedOrder.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-[#ccc] mb-2">
                      Suas bancas (ordem de prioridade)
                    </p>
                    <ul className="space-y-2">
                      {selectedOrder.map((id, index) => {
                        const b = bancas.find((x) => x.id === id);
                        const name = b?.name || b?.url || id;
                        return (
                          <li
                            key={id}
                            className="flex items-center gap-2 p-3 rounded-xl border border-[#E86A24]/30 dark:border-[#00ff00]/30 bg-[#E86A24]/5 dark:bg-[#00ff00]/10"
                          >
                            <span className="text-sm font-medium text-gray-500 dark:text-[#aaa] w-6">
                              {index + 1}º
                            </span>
                            <span className="flex-1 font-medium text-gray-900 dark:text-white truncate">
                              {name}
                            </span>
                            <div className="flex flex-col gap-0">
                              <button
                                type="button"
                                onClick={() => moveUp(index)}
                                disabled={index === 0}
                                className="p-1 rounded hover:bg-gray-200 dark:hover:bg-[#404040] disabled:opacity-40 disabled:cursor-not-allowed"
                                aria-label="Subir"
                              >
                                <ChevronUp className="w-4 h-4 text-gray-600 dark:text-[#ccc]" />
                              </button>
                              <button
                                type="button"
                                onClick={() => moveDown(index)}
                                disabled={index === selectedOrder.length - 1}
                                className="p-1 rounded hover:bg-gray-200 dark:hover:bg-[#404040] disabled:opacity-40 disabled:cursor-not-allowed"
                                aria-label="Descer"
                              >
                                <ChevronDown className="w-4 h-4 text-gray-600 dark:text-[#ccc]" />
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </>
            )}

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}
          </div>

          <div className="p-6 pt-4 border-t border-gray-100 dark:border-[#404040] flex-shrink-0">
            <button
              type="submit"
              disabled={loading || loadingBancas || bancas.length === 0 || selectedOrder.length === 0}
              className="w-full px-4 py-3 bg-[#E86A24] dark:bg-[#00ff00] hover:bg-[#7BC844] dark:hover:bg-[#00e600] text-white rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Salvando...' : 'Continuar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default BancasModal;
