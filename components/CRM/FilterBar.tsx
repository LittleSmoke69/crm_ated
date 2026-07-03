'use client';

import React, { useState, useRef, useEffect } from 'react';
import { 
  Search, 
  Filter, 
  Calendar, 
  Star, 
  DollarSign, 
  Users, 
  ChevronDown,
  X,
  Target,
  Globe,
  Tag as TagIcon,
  Clock,
  Thermometer,
  Sparkles,
  Loader2
} from 'lucide-react';

interface FilterBarProps {
  onSearch: (term: string) => void;
  onFilterChange: (type: string, value: any) => void;
  initialDateFilter?: { value: string; label: string };
  /** Chamado quando a lista de bancas terminar de carregar; recebe a listagem exclusiva (para o Kanban usar só essas bancas em "Todas as Bancas"). */
  onBancasLoaded?: (bancas: { id: string; name: string; url: string }[]) => void;
  /** Quando informado (ex.: admin visualizando CRM de outro usuário), a API de bancas retorna as bancas do usuário alvo. */
  targetUserId?: string;
  /** Para verificação de banca: 'no' = kanban (só bancas com lead não transferido), 'yes' = transferido (só bancas com lead transferido). */
  transferredFilter?: 'yes' | 'no';
}

interface Banca {
  id: string;
  name: string;
  url: string;
}

interface Tag {
  id: string;
  label: string;
  color: string;
}

const FilterBar: React.FC<FilterBarProps> = ({ onSearch, onFilterChange, initialDateFilter, onBancasLoaded, targetUserId, transferredFilter }) => {
  const [searchInputValue, setSearchInputValue] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, any>>(() => {
    if (initialDateFilter) {
      return { date: initialDateFilter };
    }
    return {};
  });
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(false);
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [bancas, setBancas] = useState<Banca[]>([]);
  const [bancasLoading, setBancasLoading] = useState<boolean>(true);
  const [bancaSearchTerm, setBancaSearchTerm] = useState<string>('');
  const [tags, setTags] = useState<Tag[]>([]);
  const [showCustomValueFilter, setShowCustomValueFilter] = useState(false);
  const [customValueMin, setCustomValueMin] = useState<string>('');
  const [customValueMax, setCustomValueMax] = useState<string>('');
  const [showCustomValueNextStarFilter, setShowCustomValueNextStarFilter] = useState(false);
  const [customValueNextStarMin, setCustomValueNextStarMin] = useState<string>('');
  const [customValueNextStarMax, setCustomValueNextStarMax] = useState<string>('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Carrega bancas (uma única vez; cleanup aborta requisição em caso de remount ex.: Strict Mode)
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    const getUserId = (): string | null => {
      try {
        return sessionStorage.getItem('user_id') || localStorage.getItem('profile_id') || null;
      } catch {
        return null;
      }
    };

    const loadBancas = async () => {
      setBancasLoading(true);
      let loadedBancas: { id: string; name: string; url: string }[] = [];
      try {
        const userId = getUserId();
        if (!userId) {
          if (!signal.aborted) {
            setBancasLoading(false);
            onBancasLoaded?.([]);
          }
          return;
        }

        const url = new URL('/api/crm/bancas', window.location.origin);
        if (targetUserId) url.searchParams.set('targetUserId', targetUserId);
        if (transferredFilter) url.searchParams.set('transferred_filter', transferredFilter);
        const response = await fetch(url.toString(), {
          headers: { 'X-User-Id': userId },
          signal,
        });

        if (signal.aborted) return;

        if (!response.ok) return;

        const result = await response.json();
        if (signal.aborted) return;

        if (result.success && Array.isArray(result.data)) {
          setBancas(result.data);
          loadedBancas = result.data;
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('[FilterBar] Erro ao carregar bancas:', err);
      } finally {
        if (!signal.aborted) {
          setBancasLoading(false);
          onBancasLoaded?.(loadedBancas);
        }
      }
    };

    loadBancas();
    return () => controller.abort();
  }, [onBancasLoaded, targetUserId, transferredFilter]);

  // Carrega tags
  useEffect(() => {
    const getUserId = (): string | null => {
      try {
        return sessionStorage.getItem('user_id') || localStorage.getItem('profile_id') || null;
      } catch {
        return null;
      }
    };

    const loadTags = async () => {
      try {
        const userId = getUserId();
        if (!userId) {
          return;
        }

        const response = await fetch('/api/crm/tags', {
          headers: { 'X-User-Id': userId },
        });

        if (!response.ok) {
          console.error('[FilterBar] Erro HTTP ao buscar tags:', response.status, response.statusText);
          return;
        }

        const result = await response.json();
        if (result.success && Array.isArray(result.data)) {
          setTags(result.data);
        } else {
          console.error('[FilterBar] Erro na resposta das tags:', result.error || 'Resposta inválida');
        }
      } catch (err: unknown) {
        console.error('[FilterBar] Erro ao carregar tags:', err instanceof Error ? err.message : err);
      }
    };
    loadTags();
  }, []);

  // Fecha o menu ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
        setShowCustomDatePicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Sincroniza o filtro inicial de data quando recebido via props
  useEffect(() => {
    if (initialDateFilter && !activeFilters.date) {
      setActiveFilters(prev => ({ ...prev, date: initialDateFilter }));
    }
  }, [initialDateFilter]);

  const handleFilterSelect = (type: string, value: any, label: string) => {
    const filterObj = { value, label };
    const newFilters = { ...activeFilters, [type]: filterObj };
    setActiveFilters(newFilters);
    onFilterChange(type, filterObj);
    setOpenMenu(null); // Fecha o menu após selecionar
  };

  const toggleMenu = (menuName: string) => {
    if (openMenu === menuName) {
      // Fechando o menu
      setOpenMenu(null);
      if (menuName === 'banca') {
        setBancaSearchTerm('');
      }
      if (menuName === 'value') {
        setShowCustomValueFilter(false);
        setCustomValueMin('');
        setCustomValueMax('');
      }
      if (menuName === 'valueNextStar') {
        setShowCustomValueNextStarFilter(false);
        setCustomValueNextStarMin('');
        setCustomValueNextStarMax('');
      }
    } else {
      // Abrindo um novo menu
      setOpenMenu(menuName);
      if (menuName !== 'banca') {
        setBancaSearchTerm('');
      }
      if (menuName !== 'value') {
        setShowCustomValueFilter(false);
        setCustomValueMin('');
        setCustomValueMax('');
      }
      if (menuName !== 'valueNextStar') {
        setShowCustomValueNextStarFilter(false);
        setCustomValueNextStarMin('');
        setCustomValueNextStarMax('');
      }
    }
  };

  const removeFilter = (type: string) => {
    const newFilters = { ...activeFilters };
    delete newFilters[type];
    setActiveFilters(newFilters);
    // Se for o filtro de data, volta para o padrão (Diário)
    if (type === 'date') {
      const defaultDate = { value: 'diario', label: 'Diário' };
      setActiveFilters({ ...newFilters, date: defaultDate });
      onFilterChange(type, defaultDate);
      // Limpa o estado do date picker personalizado
      setShowCustomDatePicker(false);
      setCustomStartDate('');
      setCustomEndDate('');
      setOpenMenu(null);
    } else if (type === 'value') {
      // Limpa o estado do filtro de valor personalizado
      setShowCustomValueFilter(false);
      setCustomValueMin('');
      setCustomValueMax('');
      onFilterChange(type, null);
    } else if (type === 'valueNextStar') {
      setShowCustomValueNextStarFilter(false);
      setCustomValueNextStarMin('');
      setCustomValueNextStarMax('');
      onFilterChange(type, null);
    } else {
      onFilterChange(type, null);
    }
  };

  return (
    <div className="flex flex-col gap-3 mb-6" ref={containerRef}>
      <div className="zap-card-muted flex flex-wrap items-center gap-3 rounded-2xl border border-[#404040] p-3 shadow-sm">
        {/* Search Field */}
        <div className="relative flex-1 min-w-[250px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input 
            type="text" 
            placeholder="Buscar por nome, email ou telefone..."
            value={searchInputValue}
            onChange={(e) => setSearchInputValue(e.target.value)}
            onBlur={(e) => onSearch(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSearch((e.target as HTMLInputElement).value);
              }
            }}
            className="w-full pl-10 pr-4 py-2.5 bg-gray-100 dark:bg-[#333] border border-gray-200 dark:border-[#555] rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#E86A24]/30 focus:bg-gray-50 dark:focus:bg-[#333] focus:border-[#E86A24]/40 transition-all"
          />
        </div>

        {/* Banca Filter */}
        <div className="relative">
          <button 
            onClick={() => !bancasLoading && toggleMenu('banca')}
            disabled={bancasLoading}
            className={`flex items-center gap-2 px-3 py-2.5 border rounded-xl text-xs font-semibold transition-all shadow-sm ${
              bancasLoading ? 'bg-gray-50 dark:bg-[#333] border-gray-100 dark:border-[#555] text-gray-400 cursor-wait' : openMenu === 'banca' ? 'bg-gray-50 dark:bg-[#333] border-gray-300 dark:border-[#555] text-[#E86A24]' : 'bg-white dark:bg-[#333] border-gray-100 dark:border-[#555] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#404040]'
            }`}
          >
            {bancasLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Globe className="w-3.5 h-3.5" />
            )}
            {bancasLoading ? 'Buscando bancas...' : (activeFilters.banca?.label || 'Todas as Bancas')}
            <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${openMenu === 'banca' ? 'rotate-180' : ''}`} />
          </button>
          {openMenu === 'banca' && (
            <div className="absolute left-0 top-full mt-2 w-56 bg-white dark:bg-[#333] rounded-xl shadow-2xl border border-gray-100 dark:border-[#404040] z-[35] animate-in fade-in slide-in-from-top-2 duration-200 overflow-hidden flex flex-col max-h-80">
              {bancasLoading ? (
                <div className="flex items-center justify-center gap-2 px-4 py-8 text-gray-500 text-xs">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>Buscando bancas...</span>
                </div>
              ) : (
                <>
                  {/* Barra de pesquisa */}
                  <div className="p-2 border-b border-gray-100">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                      <input
                        type="text"
                        placeholder="Pesquisar bancas..."
                        value={bancaSearchTerm}
                        onChange={(e) => setBancaSearchTerm(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        className="w-full pl-8 pr-2 py-1.5 text-xs border border-gray-200 dark:border-[#555] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E86A24]/30 focus:border-[#E86A24] text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder-gray-400 bg-gray-100 dark:bg-[#404040] focus:bg-gray-50 dark:focus:bg-[#404040] transition-all"
                      />
                    </div>
                  </div>
                  
                  {/* Lista de bancas com scroll - opção "Todas as Bancas" + bancas disponíveis */}
                  <div className="overflow-y-auto max-h-64 custom-scrollbar">
                    <button
                      onClick={() => {
                        handleFilterSelect('banca', 'all', 'Todas as Bancas');
                        setBancaSearchTerm('');
                      }}
                      className={`w-full text-left px-4 py-2.5 text-xs hover:bg-gray-50 dark:hover:bg-[#404040] hover:text-[#E86A24] transition-colors font-bold border-b border-gray-100 dark:border-[#404040] ${
                        activeFilters.banca?.value === 'all' || !activeFilters.banca?.value ? 'bg-gray-50 dark:bg-[#404040] text-[#E86A24]' : 'text-gray-600 dark:text-gray-300'
                      }`}
                    >
                      Todas as Bancas
                    </button>
                    {(bancaSearchTerm
                      ? bancas.filter(b => b.name.toLowerCase().includes(bancaSearchTerm.toLowerCase()))
                      : bancas
                    ).map(banca => (
                      <button 
                        key={banca.id}
                        onClick={() => {
                          handleFilterSelect('banca', banca.url, banca.name);
                          setBancaSearchTerm('');
                        }}
                        className={`w-full text-left px-4 py-2.5 text-xs hover:bg-gray-50 dark:hover:bg-[#404040] hover:text-[#E86A24] transition-colors font-bold ${
                          activeFilters.banca?.value === banca.url ? 'bg-gray-50 dark:bg-[#404040] text-[#E86A24]' : 'text-gray-600 dark:text-gray-300'
                        }`}
                      >
                        {banca.name}
                      </button>
                    ))}
                    {bancaSearchTerm && bancas.filter(b => b.name.toLowerCase().includes(bancaSearchTerm.toLowerCase())).length === 0 && (
                      <div className="px-4 py-2 text-[10px] text-gray-400 text-center">
                        Nenhuma banca encontrada
                      </div>
                    )}
                    {!bancaSearchTerm && bancas.length === 0 && (
                      <div className="px-4 py-2 text-[10px] text-gray-400 text-center">
                        Nenhuma banca disponível
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Period Filter */}
        <div className="relative">
          <button 
            onClick={() => toggleMenu('date')}
            className={`flex items-center gap-2 px-3 py-2.5 border rounded-xl text-xs font-semibold transition-all shadow-sm ${
              openMenu === 'date' ? 'bg-gray-50 dark:bg-[#333] border-gray-300 dark:border-[#555] text-[#E86A24]' : 'bg-white dark:bg-[#333] border-gray-100 dark:border-[#555] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#404040]'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            {activeFilters.date?.value?.startsWith('custom_') ? 'Período' : (activeFilters.date?.label || 'Diário')}
            <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${openMenu === 'date' ? 'rotate-180' : ''}`} />
          </button>
          {openMenu === 'date' && (
            <div className="absolute left-0 top-full mt-2 w-56 bg-white dark:bg-[#333] rounded-xl shadow-2xl border border-gray-100 dark:border-[#404040] py-2 z-[35] animate-in fade-in slide-in-from-top-2 duration-200">
              {[
                { value: 'diario', label: 'Diário' },
                { value: 'ontem', label: 'Ontem' },
                { value: '7dias', label: 'Últimos 7 dias' },
                { value: '15dias', label: 'Últimos 15 dias' },
                { value: '30dias', label: 'Últimos 30 dias' },
                { value: 'todos', label: 'Todo o Período' }
              ].map(option => (
                <button 
                  key={option.value}
                  onClick={() => {
                    handleFilterSelect('date', option.value, option.label);
                  }}
                  className={`w-full text-left px-4 py-2 text-xs hover:bg-gray-50 dark:hover:bg-[#404040] hover:text-[#E86A24] transition-colors font-bold ${
                    activeFilters.date?.value === option.value ? 'bg-gray-50 dark:bg-[#404040] text-[#E86A24]' : 'text-gray-600 dark:text-gray-300'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Custom Date Range Filter */}
        <div className="relative">
          <button 
            onClick={() => {
              if (openMenu === 'customDate') {
                setOpenMenu(null);
                setShowCustomDatePicker(false);
              } else {
                setOpenMenu('customDate');
                setShowCustomDatePicker(true);
                // Se houver um filtro personalizado ativo, preenche os campos
                if (activeFilters.date?.value?.startsWith('custom_')) {
                  const parts = activeFilters.date.value.split('_');
                  if (parts.length === 3) {
                    setCustomStartDate(parts[1]);
                    setCustomEndDate(parts[2]);
                  }
                }
              }
            }}
            className={`flex items-center gap-2 px-3 py-2.5 border rounded-xl text-xs font-semibold transition-all shadow-sm ${
              openMenu === 'customDate' || activeFilters.date?.value?.startsWith('custom_') ? 'bg-gray-50 dark:bg-[#333] border-gray-300 dark:border-[#555] text-[#E86A24]' : 'bg-white dark:bg-[#333] border-gray-100 dark:border-[#555] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#404040]'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            {activeFilters.date?.value?.startsWith('custom_') ? activeFilters.date.label : 'Data Personalizada'}
            <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${openMenu === 'customDate' ? 'rotate-180' : ''}`} />
          </button>
          {showCustomDatePicker && openMenu === 'customDate' && (
            <div className="absolute left-0 top-full mt-2 w-64 bg-white dark:bg-[#333] rounded-xl shadow-2xl border border-gray-100 dark:border-[#404040] p-4 z-[35] animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Data Inicial</label>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    max={customEndDate || new Date().toISOString().split('T')[0]}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-[#555] rounded-lg text-sm text-gray-800 dark:text-white focus:ring-2 focus:ring-[#E86A24] focus:border-emerald-500 bg-white dark:bg-[#404040] transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Data Final</label>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    min={customStartDate}
                    max={new Date().toISOString().split('T')[0]}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-[#555] rounded-lg text-sm text-gray-800 dark:text-white focus:ring-2 focus:ring-[#E86A24] focus:border-emerald-500 bg-white dark:bg-[#404040] transition-all"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowCustomDatePicker(false);
                      setOpenMenu(null);
                      setCustomStartDate('');
                      setCustomEndDate('');
                    }}
                    className="flex-1 px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-xs font-bold hover:bg-gray-200 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => {
                      if (customStartDate && customEndDate) {
                        // Formata a data corretamente sem problemas de timezone
                        const formatDate = (dateStr: string) => {
                          // dateStr já vem no formato YYYY-MM-DD do input type="date"
                          const [year, month, day] = dateStr.split('-');
                          return `${day}/${month}/${year}`;
                        };
                        
                        const label = `De ${formatDate(customStartDate)} até ${formatDate(customEndDate)}`;
                        handleFilterSelect('date', `custom_${customStartDate}_${customEndDate}`, label);
                        setShowCustomDatePicker(false);
                        setOpenMenu(null);
                        setCustomStartDate('');
                        setCustomEndDate('');
                      }
                    }}
                    disabled={!customStartDate || !customEndDate}
                    className="flex-1 px-3 py-2 bg-[#E86A24] text-white rounded-lg text-xs font-bold hover:bg-[#D95E1B] disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                  >
                    Aplicar
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Affiliate Filter */}
        <div className="relative">
          <button 
            onClick={() => toggleMenu('affiliate')}
            className={`flex items-center gap-2 px-3 py-2.5 border rounded-xl text-xs font-semibold transition-all shadow-sm ${
              openMenu === 'affiliate' ? 'bg-gray-50 dark:bg-[#333] border-gray-300 dark:border-[#555] text-[#E86A24]' : 'bg-white dark:bg-[#333] border-gray-100 dark:border-[#555] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#404040]'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            {activeFilters.affiliate?.label || 'Afiliado'}
            <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${openMenu === 'affiliate' ? 'rotate-180' : ''}`} />
          </button>
          {openMenu === 'affiliate' && (
            <div className="absolute left-0 top-full mt-2 w-48 bg-white rounded-xl shadow-2xl border border-gray-100 py-2 z-[35] animate-in fade-in slide-in-from-top-2 duration-200">
              <button onClick={() => handleFilterSelect('affiliate', 'yes', 'Com Afiliado')} className="w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 hover:text-[#C9531A] transition-colors font-bold">Com Afiliado</button>
              <button onClick={() => handleFilterSelect('affiliate', 'no', 'Sem Afiliado')} className="w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 hover:text-[#C9531A] transition-colors font-bold">Sem Afiliado</button>
            </div>
          )}
        </div>

        {/* Stars Filter */}
        <div className="relative">
          <button 
            onClick={() => toggleMenu('stars')}
            className={`flex items-center gap-2 px-3 py-2.5 border rounded-xl text-xs font-semibold transition-all shadow-sm ${
              openMenu === 'stars' ? 'bg-gray-50 dark:bg-[#333] border-gray-300 dark:border-[#555] text-[#E86A24]' : 'bg-white dark:bg-[#333] border-gray-100 dark:border-[#555] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#404040]'
            }`}
          >
            <Star className="w-3.5 h-3.5" />
            {activeFilters.stars?.label || 'Estrela'}
            <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${openMenu === 'stars' ? 'rotate-180' : ''}`} />
          </button>
          {openMenu === 'stars' && (
            <div className="absolute left-0 top-full mt-2 w-48 bg-white rounded-xl shadow-2xl border border-gray-100 py-2 z-[35] animate-in fade-in slide-in-from-top-2 duration-200">
              {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(s => (
                <button 
                  key={s}
                  onClick={() => handleFilterSelect('stars', s.toString(), `${s} Estrelas`)}
                  className="w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-1">
                    <div className="flex shrink-0">
                      {[...Array(s)].map((_, i) => <Star key={i} className="w-2 h-2 fill-amber-400 text-amber-400" />)}
                    </div>
                    <span className="ml-auto font-bold text-[10px] text-gray-400">{s}.0</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Value Filter */}
        <div className="relative">
          <button 
            onClick={() => toggleMenu('value')}
            className={`flex items-center gap-2 px-3 py-2.5 border rounded-xl text-xs font-semibold transition-all shadow-sm ${
              openMenu === 'value' ? 'bg-gray-50 dark:bg-[#333] border-gray-300 dark:border-[#555] text-[#E86A24]' : 'bg-white dark:bg-[#333] border-gray-100 dark:border-[#555] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#404040]'
            }`}
          >
            <DollarSign className="w-3.5 h-3.5" />
            {activeFilters.value?.label || 'Total depósito'}
            <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${openMenu === 'value' ? 'rotate-180' : ''}`} />
          </button>
          {openMenu === 'value' && (
            <div className="absolute left-0 top-full mt-2 w-64 bg-white rounded-xl shadow-2xl border border-gray-100 py-2 z-[35] animate-in fade-in slide-in-from-top-2 duration-200">
              <button onClick={() => handleFilterSelect('value', 'none', 'Sem Depósito')} className="w-full text-left px-4 py-2.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-[#C9531A] transition-colors font-bold">Sem Depósito</button>
              <button onClick={() => handleFilterSelect('value', 'low', 'Baixo Valor (Menos de R$10)')} className="w-full text-left px-4 py-2.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-[#C9531A] transition-colors font-bold">Baixo Valor (Menos de R$10)</button>
              <button onClick={() => handleFilterSelect('value', 'medium', 'Médio Valor (R$10 a R$99)')} className="w-full text-left px-4 py-2.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-[#C9531A] transition-colors font-bold">Médio Valor (R$10 a R$99)</button>
              <button onClick={() => handleFilterSelect('value', 'high', 'Alto Valor (R$100 a R$500)')} className="w-full text-left px-4 py-2.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-[#C9531A] transition-colors font-bold">Alto Valor (R$100 a R$500)</button>
              <button onClick={() => handleFilterSelect('value', 'high_premium', 'Alto Padrão (R$500 a R$1000)')} className="w-full text-left px-4 py-2.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-[#C9531A] transition-colors font-bold">Alto Padrão (R$500 a R$1000)</button>
              <button onClick={() => handleFilterSelect('value', 'ultra', 'Ultra Padrão (Maior que R$1000)')} className="w-full text-left px-4 py-2.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-[#C9531A] transition-colors font-bold">Ultra Padrão (Maior que R$1000)</button>
              <div className="border-t border-gray-100 my-1"></div>
              <button 
                onClick={() => {
                  setShowCustomValueFilter(true);
                  // Não fecha o menu ainda, deixa aberto para mostrar os campos
                }}
                className="w-full text-left px-4 py-2.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-[#C9531A] transition-colors font-bold"
              >
                Personalizado
              </button>
              
              {showCustomValueFilter && (
                <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 mb-1.5 uppercase">Maior que</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={customValueMin}
                        onChange={(e) => setCustomValueMin(e.target.value)}
                        placeholder="0.00"
                        className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] outline-none text-gray-800 placeholder:text-gray-400 bg-white focus:bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 mb-1.5 uppercase">Menor que</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={customValueMax}
                        onChange={(e) => setCustomValueMax(e.target.value)}
                        placeholder="0.00"
                        className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] outline-none text-gray-800 placeholder:text-gray-400 bg-white focus:bg-white"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          if (customValueMin || customValueMax) {
                            const min = customValueMin ? parseFloat(customValueMin) : null;
                            const max = customValueMax ? parseFloat(customValueMax) : null;
                            
                            // Valida se os valores são números válidos
                            if (min !== null && (isNaN(min) || min < 0)) return;
                            if (max !== null && (isNaN(max) || max < 0)) return;
                            if (min !== null && max !== null && min > max) return;
                            
                            let label = 'Personalizado';
                            if (min !== null && max !== null) {
                              label = `R$ ${min.toFixed(2)} - R$ ${max.toFixed(2)}`;
                            } else if (min !== null) {
                              label = `Maior que R$ ${min.toFixed(2)}`;
                            } else if (max !== null) {
                              label = `Menor que R$ ${max.toFixed(2)}`;
                            }
                            handleFilterSelect('value', { type: 'custom', min, max }, label);
                            setShowCustomValueFilter(false);
                            setCustomValueMin('');
                            setCustomValueMax('');
                            setOpenMenu(null);
                          }
                        }}
                        disabled={Boolean((!customValueMin && !customValueMax) || 
                                 (customValueMin && (isNaN(parseFloat(customValueMin)) || parseFloat(customValueMin) < 0)) ||
                                 (customValueMax && (isNaN(parseFloat(customValueMax)) || parseFloat(customValueMax) < 0)) ||
                                 (customValueMin && customValueMax && parseFloat(customValueMin) > parseFloat(customValueMax)))}
                        className="flex-1 px-3 py-2 bg-[#E86A24] text-white rounded-lg text-xs font-bold hover:bg-[#D95E1B] disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                      >
                        Aplicar
                      </button>
                      <button
                        onClick={() => {
                          setShowCustomValueFilter(false);
                          setCustomValueMin('');
                          setCustomValueMax('');
                        }}
                        className="px-3 py-2 bg-gray-200 text-gray-600 rounded-lg text-xs font-bold hover:bg-gray-300 transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Valor para próxima estrela (falta para subir de nível) */}
        <div className="relative">
          <button 
            onClick={() => toggleMenu('valueNextStar')}
            className={`flex items-center gap-2 px-3 py-2.5 border rounded-xl text-xs font-semibold transition-all shadow-sm ${
              openMenu === 'valueNextStar' ? 'bg-gray-50 dark:bg-[#333] border-gray-300 dark:border-[#555] text-[#E86A24]' : 'bg-white dark:bg-[#333] border-gray-100 dark:border-[#555] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#404040]'
            }`}
          >
            <Target className="w-3.5 h-3.5" />
            {activeFilters.valueNextStar?.label || 'Falta p/ Estrela'}
            <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${openMenu === 'valueNextStar' ? 'rotate-180' : ''}`} />
          </button>
          {openMenu === 'valueNextStar' && (
            <div className="absolute left-0 top-full mt-2 w-64 bg-white rounded-xl shadow-2xl border border-gray-100 py-2 z-[35] animate-in fade-in slide-in-from-top-2 duration-200">
              <button onClick={() => handleFilterSelect('valueNextStar', 'none', 'Não se aplica (máx.)')} className="w-full text-left px-4 py-2.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-[#C9531A] transition-colors font-bold">Não se aplica (máx.)</button>
              <button onClick={() => handleFilterSelect('valueNextStar', 'low', 'Pouco (Menos de R$50)')} className="w-full text-left px-4 py-2.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-[#C9531A] transition-colors font-bold">Pouco (Menos de R$50)</button>
              <button onClick={() => handleFilterSelect('valueNextStar', 'medium', 'Médio (R$50 a R$199)')} className="w-full text-left px-4 py-2.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-[#C9531A] transition-colors font-bold">Médio (R$50 a R$199)</button>
              <button onClick={() => handleFilterSelect('valueNextStar', 'high', 'Alto (R$200 a R$500)')} className="w-full text-left px-4 py-2.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-[#C9531A] transition-colors font-bold">Alto (R$200 a R$500)</button>
              <button onClick={() => handleFilterSelect('valueNextStar', 'ultra', 'Muito alto (Acima de R$500)')} className="w-full text-left px-4 py-2.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-[#C9531A] transition-colors font-bold">Muito alto (Acima de R$500)</button>
              <div className="border-t border-gray-100 my-1"></div>
              <button 
                onClick={() => setShowCustomValueNextStarFilter(true)}
                className="w-full text-left px-4 py-2.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-[#C9531A] transition-colors font-bold"
              >
                Personalizado
              </button>
              {showCustomValueNextStarFilter && (
                <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 mb-1.5 uppercase">Falta maior que (R$)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={customValueNextStarMin}
                        onChange={(e) => setCustomValueNextStarMin(e.target.value)}
                        placeholder="0.00"
                        className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] outline-none text-gray-800 placeholder:text-gray-400 bg-white focus:bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 mb-1.5 uppercase">Falta menor que (R$)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={customValueNextStarMax}
                        onChange={(e) => setCustomValueNextStarMax(e.target.value)}
                        placeholder="0.00"
                        className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] outline-none text-gray-800 placeholder:text-gray-400 bg-white focus:bg-white"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          if (customValueNextStarMin || customValueNextStarMax) {
                            const min = customValueNextStarMin ? parseFloat(customValueNextStarMin) : null;
                            const max = customValueNextStarMax ? parseFloat(customValueNextStarMax) : null;
                            if (min !== null && (isNaN(min) || min < 0)) return;
                            if (max !== null && (isNaN(max) || max < 0)) return;
                            if (min !== null && max !== null && min > max) return;
                            let label = 'Personalizado';
                            if (min !== null && max !== null) {
                              label = `Falta R$ ${min.toFixed(2)} - R$ ${max.toFixed(2)}`;
                            } else if (min !== null) {
                              label = `Falta > R$ ${min.toFixed(2)}`;
                            } else if (max !== null) {
                              label = `Falta < R$ ${max.toFixed(2)}`;
                            }
                            handleFilterSelect('valueNextStar', { type: 'custom', min, max }, label);
                            setShowCustomValueNextStarFilter(false);
                            setCustomValueNextStarMin('');
                            setCustomValueNextStarMax('');
                            setOpenMenu(null);
                          }
                        }}
                        disabled={Boolean((!customValueNextStarMin && !customValueNextStarMax) ||
                                 (customValueNextStarMin && (isNaN(parseFloat(customValueNextStarMin)) || parseFloat(customValueNextStarMin) < 0)) ||
                                 (customValueNextStarMax && (isNaN(parseFloat(customValueNextStarMax)) || parseFloat(customValueNextStarMax) < 0)) ||
                                 (customValueNextStarMin && customValueNextStarMax && parseFloat(customValueNextStarMin) > parseFloat(customValueNextStarMax)))}
                        className="flex-1 px-3 py-2 bg-[#E86A24] text-white rounded-lg text-xs font-bold hover:bg-[#D95E1B] disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                      >
                        Aplicar
                      </button>
                      <button
                        onClick={() => {
                          setShowCustomValueNextStarFilter(false);
                          setCustomValueNextStarMin('');
                          setCustomValueNextStarMax('');
                        }}
                        className="px-3 py-2 bg-gray-200 text-gray-600 rounded-lg text-xs font-bold hover:bg-gray-300 transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Last Deposit Date Filter */}
        <div className="relative">
          <button 
            onClick={() => toggleMenu('lastDepositDate')}
            className={`flex items-center gap-2 px-3 py-2.5 border rounded-xl text-xs font-semibold transition-all shadow-sm ${
              openMenu === 'lastDepositDate' ? 'bg-gray-50 dark:bg-[#333] border-gray-300 dark:border-[#555] text-[#E86A24]' : 'bg-white dark:bg-[#333] border-gray-100 dark:border-[#555] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#404040]'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            {activeFilters.lastDepositDate?.label || 'Último Depósito'}
            <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${openMenu === 'lastDepositDate' ? 'rotate-180' : ''}`} />
          </button>
          {openMenu === 'lastDepositDate' && (
            <div className="absolute left-0 top-full mt-2 w-56 bg-white dark:bg-[#333] rounded-xl shadow-2xl border border-gray-100 dark:border-[#404040] py-2 z-[35] animate-in fade-in slide-in-from-top-2 duration-200">
              {[
                { value: 'hoje', label: 'Hoje' },
                { value: '1', label: '1 dia' },
                { value: '2', label: '2 dias' },
                { value: '5', label: '5 dias' },
                { value: '10', label: '10 dias' },
                { value: '15', label: '15 dias' },
                { value: '30', label: '30 dias +' },
              ].map(option => (
                <button 
                  key={option.value}
                  onClick={() => handleFilterSelect('lastDepositDate', option.value, option.label)}
                  className={`w-full text-left px-4 py-2.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-[#C9531A] transition-colors font-bold ${
                    activeFilters.lastDepositDate?.value === option.value ? 'bg-gray-50 text-[#C9531A]' : ''
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Temperature Filter */}
        <div className="relative">
          <button 
            onClick={() => toggleMenu('temperature')}
            className={`flex items-center gap-2 px-3 py-2.5 border rounded-xl text-xs font-semibold transition-all shadow-sm ${
              openMenu === 'temperature' ? 'bg-gray-50 dark:bg-[#333] border-gray-300 dark:border-[#555] text-[#E86A24]' : 'bg-white dark:bg-[#333] border-gray-100 dark:border-[#555] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#404040]'
            }`}
          >
            <Thermometer className="w-3.5 h-3.5" />
            {activeFilters.temperature?.label || 'Temperatura'}
            <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${openMenu === 'temperature' ? 'rotate-180' : ''}`} />
          </button>
          {openMenu === 'temperature' && (
            <div className="absolute left-0 top-full mt-2 w-56 bg-white dark:bg-[#333] rounded-xl shadow-2xl border border-gray-100 dark:border-[#404040] py-2 z-[35] animate-in fade-in slide-in-from-top-2 duration-200">
              {[
                { value: 'cold', label: 'Frio (Cold)' },
                { value: 'very_cold', label: 'Muito Frio (Very Cold)' },
                { value: 'active', label: 'Ativo (Active)' },
                { value: 'hot', label: 'Quente (Hot)' },
                { value: 'cooling', label: 'Esfriando (Cooling)' },
              ].map(option => (
                <button 
                  key={option.value}
                  onClick={() => handleFilterSelect('temperature', option.value, option.label)}
                  className={`w-full text-left px-4 py-2.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-[#C9531A] transition-colors font-bold ${
                    activeFilters.temperature?.value === option.value ? 'bg-gray-50 text-[#C9531A]' : ''
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Classification Filter */}
        <div className="relative">
          <button 
            onClick={() => toggleMenu('classification')}
            className={`flex items-center gap-2 px-3 py-2.5 border rounded-xl text-xs font-semibold transition-all shadow-sm ${
              openMenu === 'classification' ? 'bg-gray-50 dark:bg-[#333] border-gray-300 dark:border-[#555] text-[#E86A24]' : 'bg-white dark:bg-[#333] border-gray-100 dark:border-[#555] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#404040]'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            {activeFilters.classification?.label || 'Classificação'}
            <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${openMenu === 'classification' ? 'rotate-180' : ''}`} />
          </button>
          {openMenu === 'classification' && (
            <div className="absolute left-0 top-full mt-2 w-56 bg-white dark:bg-[#333] rounded-xl shadow-2xl border border-gray-100 dark:border-[#404040] py-2 z-[35] animate-in fade-in slide-in-from-top-2 duration-200">
              {[
                { value: 'high_value', label: 'Alto Valor (High Value)', color: 'yellow' },
                { value: 'vip', label: 'VIP', color: 'purple' },
                { value: 'oportunidade', label: 'Oportunidade', color: 'orange' },
                { value: 'alerta', label: 'Alerta', color: 'red' },
              ].map(option => (
                <button 
                  key={option.value}
                  onClick={() => handleFilterSelect('classification', option.value, option.label)}
                  className={`w-full text-left px-4 py-2.5 text-xs text-gray-600 hover:bg-gray-50 hover:text-[#C9531A] transition-colors font-bold flex items-center gap-2 ${
                    activeFilters.classification?.value === option.value ? 'bg-gray-50 text-[#C9531A]' : ''
                  }`}
                >
                  <div 
                    className={`w-3 h-3 rounded-full shrink-0 border-2 ${
                      option.color === 'yellow' ? 'bg-amber-200 border-amber-400' :
                      option.color === 'purple' ? 'bg-indigo-200 border-indigo-400' :
                      option.color === 'orange' ? 'bg-orange-200 border-orange-400' :
                      'bg-red-200 border-red-400'
                    }`}
                  />
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Filtro: Apenas possível transferência (90+ dias sem depósito) */}
        <div className="relative">
          <button 
            onClick={() => toggleMenu('possivelTransferencia')}
            className={`flex items-center gap-2 px-3 py-2.5 border rounded-xl text-xs font-semibold transition-all shadow-sm ${
              openMenu === 'possivelTransferencia' ? 'bg-gray-50 dark:bg-[#333] border-gray-300 dark:border-[#555] text-[#E86A24]' : 'bg-white dark:bg-[#333] border-gray-100 dark:border-[#555] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#404040]'
            }`}
          >
            <Target className="w-3.5 h-3.5" />
            {activeFilters.possivelTransferencia?.value === 'only' ? 'Apenas possível transferência' : 'Possível transferência'}
            <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${openMenu === 'possivelTransferencia' ? 'rotate-180' : ''}`} />
          </button>
          {openMenu === 'possivelTransferencia' && (
            <div className="absolute left-0 top-full mt-2 w-56 bg-white dark:bg-[#333] rounded-xl shadow-2xl border border-gray-100 dark:border-[#404040] py-2 z-[35] animate-in fade-in slide-in-from-top-2 duration-200">
              {[
                { value: null, label: 'Todos' },
                { value: 'only', label: 'Apenas possível transferência' },
              ].map(option => (
                <button 
                  key={option.value ?? 'all'}
                  onClick={() => {
                    if (option.value === null) {
                      removeFilter('possivelTransferencia');
                    } else {
                      handleFilterSelect('possivelTransferencia', option.value, option.label);
                    }
                    setOpenMenu(null);
                  }}
                  className={`w-full text-left px-4 py-2.5 text-xs hover:bg-gray-50 dark:hover:bg-[#404040] hover:text-[#E86A24] transition-colors font-bold ${
                    (option.value === null && !activeFilters.possivelTransferencia) || activeFilters.possivelTransferencia?.value === option.value ? 'bg-gray-50 dark:bg-[#404040] text-[#C9531A]' : 'text-gray-600 dark:text-gray-300'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Tags Filter */}
        <div className="relative">
          <button 
            onClick={() => toggleMenu('tags')}
            className={`flex items-center gap-2 px-3 py-2.5 border rounded-xl text-xs font-semibold transition-all shadow-sm ${
              openMenu === 'tags' ? 'bg-gray-50 dark:bg-[#333] border-gray-300 dark:border-[#555] text-[#E86A24]' : 'bg-white dark:bg-[#333] border-gray-100 dark:border-[#555] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#404040]'
            }`}
          >
            <TagIcon className="w-3.5 h-3.5" />
            {activeFilters.tags?.label || 'Etiquetas'}
            <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${openMenu === 'tags' ? 'rotate-180' : ''}`} />
          </button>
          {openMenu === 'tags' && (
            <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-2xl border border-gray-100 py-2 z-[35] animate-in fade-in slide-in-from-top-2 duration-200 max-h-[300px] overflow-y-auto">
              {/* Opções de presença de etiquetas */}
              <button
                onClick={() => handleFilterSelect('tags', '__has_any', 'Com etiquetas')}
                className={`w-full text-left px-4 py-2.5 text-xs hover:bg-gray-50 hover:text-[#C9531A] transition-colors font-bold flex items-center gap-2 border-b border-gray-100 ${
                  activeFilters.tags?.value === '__has_any' ? 'bg-gray-50 text-[#C9531A]' : 'text-gray-600'
                }`}
              >
                <TagIcon className="w-3 h-3 shrink-0" />
                Com etiquetas
              </button>
              <button
                onClick={() => handleFilterSelect('tags', '__none', 'Sem etiquetas')}
                className={`w-full text-left px-4 py-2.5 text-xs hover:bg-gray-50 hover:text-[#C9531A] transition-colors font-bold flex items-center gap-2 border-b border-gray-100 ${
                  activeFilters.tags?.value === '__none' ? 'bg-gray-50 text-[#C9531A]' : 'text-gray-600'
                }`}
              >
                <TagIcon className="w-3 h-3 shrink-0 opacity-50" />
                Sem etiquetas
              </button>
              {/* Etiquetas específicas */}
              {tags.length === 0 ? (
                <div className="px-4 py-2 text-xs text-gray-400">Nenhuma etiqueta cadastrada</div>
              ) : (
                tags.map(tag => (
                  <button 
                    key={tag.id}
                    onClick={() => handleFilterSelect('tags', tag.id, tag.label)}
                    className={`w-full text-left px-4 py-2.5 text-xs hover:bg-gray-50 hover:text-[#C9531A] transition-colors font-bold flex items-center gap-2 ${
                      activeFilters.tags?.value === tag.id ? 'bg-gray-50 text-[#C9531A]' : 'text-gray-600'
                    }`}
                  >
                    <div 
                      className="w-3 h-3 rounded-full shrink-0" 
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.label}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Active Filters Display */}
          {Object.keys(activeFilters).length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 tracking-wider ml-1">Filtros ativos:</span>
          {Object.entries(activeFilters).map(([type, filter]) => (
            <div key={type} className="flex items-center gap-1.5 bg-gray-50 dark:bg-[#333] text-[#E86A24] px-2.5 py-1 rounded-lg text-[10px] font-bold border border-gray-200 dark:border-[#404040] transition-all animate-in fade-in zoom-in-95">
              {filter.label}
              <button onClick={() => removeFilter(type)} className="hover:bg-emerald-100 p-0.5 rounded-md transition-colors">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button 
            onClick={() => {
              setActiveFilters({});
              onFilterChange('clear', null);
            }}
            className="text-[10px] font-bold text-gray-400 hover:text-red-500 transition-colors ml-1"
          >
            Limpar todos
          </button>
        </div>
      )}
    </div>
  );
};

export default FilterBar;
