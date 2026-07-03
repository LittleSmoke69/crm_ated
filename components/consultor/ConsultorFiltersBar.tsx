'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronDown, Filter, Search, Users } from 'lucide-react';

export type DateFilterKey = 'daily' | 'yesterday' | '7days' | '15days' | '30days' | 'custom' | 'all';

export interface BancaOption {
  id: string;
  name: string;
  url: string;
}

export interface ConsultorOption {
  id: string;
  email: string;
  full_name: string | null;
  status?: string | null;
}

export interface ConsultorFiltersBarProps {
  // banca
  bancas: BancaOption[];
  selectedBanca: string | null;
  onChangeBanca: (url: string | null) => void;

  // consultor (opcional — só aparece quando showConsultorFilter=true, ex.: admin/super_admin)
  showConsultorFilter?: boolean;
  consultores: ConsultorOption[];
  consultoresLoading?: boolean;
  selectedConsultorId: string;
  onChangeConsultor: (id: string) => void;

  // data
  dateFilter: DateFilterKey;
  onChangeDateFilter: (filter: DateFilterKey) => void;
  customStartDate: string;
  customEndDate: string;
  onChangeCustomStartDate: (date: string) => void;
  onChangeCustomEndDate: (date: string) => void;
  onApplyCustomDate: () => void;

  // slot extra à direita (ex.: ExportCsvMenu, botão "Meu CRM" etc.)
  rightSlot?: React.ReactNode;
}

const buttonClass =
  'flex items-center gap-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] px-4 py-2.5 rounded-xl text-sm font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#333] transition-all shadow-sm';

const DATE_FILTER_LABEL: Record<DateFilterKey, string> = {
  daily: 'Diário',
  yesterday: 'Ontem',
  '7days': 'Últimos 7 dias',
  '15days': 'Últimos 15 dias',
  '30days': 'Últimos 30 dias',
  custom: 'Personalizado',
  all: 'Todo o Período',
};

export default function ConsultorFiltersBar(props: ConsultorFiltersBarProps) {
  const {
    bancas,
    selectedBanca,
    onChangeBanca,
    showConsultorFilter = false,
    consultores,
    consultoresLoading = false,
    selectedConsultorId,
    onChangeConsultor,
    dateFilter,
    onChangeDateFilter,
    customStartDate,
    customEndDate,
    onChangeCustomStartDate,
    onChangeCustomEndDate,
    onApplyCustomDate,
    rightSlot,
  } = props;

  const bancaRef = useRef<HTMLDivElement | null>(null);
  const consultorRef = useRef<HTMLDivElement | null>(null);
  const dateRef = useRef<HTMLDivElement | null>(null);

  const [showBanca, setShowBanca] = useState(false);
  const [showConsultor, setShowConsultor] = useState(false);
  const [showDate, setShowDate] = useState(false);
  const [bancaSearch, setBancaSearch] = useState('');
  const [consultorSearch, setConsultorSearch] = useState('');

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (showBanca && bancaRef.current && !bancaRef.current.contains(t)) setShowBanca(false);
      if (showConsultor && consultorRef.current && !consultorRef.current.contains(t)) setShowConsultor(false);
      if (showDate && dateRef.current && !dateRef.current.contains(t)) setShowDate(false);
    }
    if (showBanca || showConsultor || showDate) {
      document.addEventListener('mousedown', handleOutside);
    }
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showBanca, showConsultor, showDate]);

  const filteredBancas = useMemo(
    () => bancas.filter((b) => (b.name || '').toLowerCase().includes(bancaSearch.toLowerCase())),
    [bancas, bancaSearch]
  );

  const filteredConsultores = useMemo(
    () =>
      consultores.filter((c) =>
        (c.full_name || c.email || '').toLowerCase().includes(consultorSearch.toLowerCase())
      ),
    [consultores, consultorSearch]
  );

  const selectedBancaName = selectedBanca
    ? bancas.find((b) => b.url === selectedBanca)?.name || 'Banca Selecionada'
    : 'Todas as Bancas';

  const selectedConsultor = consultores.find((c) => c.id === selectedConsultorId);

  return (
    <div className="flex gap-2 flex-wrap">
      {/* Banca */}
      <div ref={bancaRef} className="relative">
        <button
          onClick={() => {
            setShowBanca((v) => !v);
            setShowConsultor(false);
            setShowDate(false);
          }}
          className={buttonClass}
        >
          <Filter className="w-4 h-4 text-[#E86A24]" />
          <span className="truncate max-w-[150px]">{selectedBancaName}</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showBanca ? 'rotate-180' : ''}`} />
        </button>
        {showBanca && (
          <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-[#2a2a2a] border border-gray-100 dark:border-[#404040] rounded-2xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="p-3 border-b border-gray-100 dark:border-[#404040]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar banca..."
                  value={bancaSearch}
                  onChange={(e) => setBancaSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-gray-100 dark:bg-[#333] border border-gray-200 dark:border-[#404040] rounded-lg text-sm text-gray-900 dark:text-gray-100 font-bold focus:ring-2 focus:ring-[#E86A24]/30 placeholder:text-gray-500 dark:placeholder:text-gray-500 outline-none"
                />
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto p-2">
              <button
                onClick={() => {
                  onChangeBanca(null);
                  setShowBanca(false);
                }}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all mb-1 ${
                  !selectedBanca
                    ? 'bg-[#E86A2410] text-[#E86A24] font-bold'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#333]'
                }`}
              >
                Todas as Bancas
              </button>
              {filteredBancas.map((banca) => (
                <button
                  key={banca.id}
                  onClick={() => {
                    onChangeBanca(banca.url);
                    setShowBanca(false);
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all mb-1 ${
                    selectedBanca === banca.url
                      ? 'bg-[#E86A2410] text-[#E86A24] font-bold'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#333]'
                  }`}
                >
                  <div className="font-bold">{banca.name}</div>
                </button>
              ))}
              {filteredBancas.length === 0 && (
                <div className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                  Nenhuma banca encontrada
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Consultor (opcional) */}
      {showConsultorFilter && (
        <div ref={consultorRef} className="relative">
          <button
            onClick={() => {
              setShowConsultor((v) => !v);
              setShowBanca(false);
              setShowDate(false);
            }}
            disabled={consultoresLoading || consultores.length === 0}
            className={`${buttonClass} disabled:opacity-80`}
          >
            <Users className="w-4 h-4 text-[#E86A24]" />
            {consultoresLoading
              ? 'Carregando...'
              : selectedConsultorId === 'all'
              ? 'Todos os consultores'
              : selectedConsultor?.full_name || selectedConsultor?.email || 'Consultor'}
            <ChevronDown className={`w-4 h-4 transition-transform ${showConsultor ? 'rotate-180' : ''}`} />
          </button>
          {showConsultor && (
            <div className="absolute right-0 mt-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-xl shadow-lg z-50 min-w-[240px] max-h-[360px] overflow-hidden flex flex-col">
              <div className="p-2 border-b border-gray-100 dark:border-[#404040]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
                  <input
                    type="text"
                    placeholder="Pesquisar consultor..."
                    value={consultorSearch}
                    onChange={(e) => setConsultorSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-gray-100 dark:bg-[#333] border border-gray-200 dark:border-[#404040] rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-[#E86A24]/30 outline-none placeholder:text-gray-500 dark:placeholder:text-gray-500"
                    autoFocus
                  />
                </div>
              </div>
              <div className="overflow-y-auto max-h-[280px] p-2">
                <button
                  onClick={() => {
                    onChangeConsultor('all');
                    setShowConsultor(false);
                    setConsultorSearch('');
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    selectedConsultorId === 'all'
                      ? 'bg-[#E86A2415] text-[#E86A24] font-medium'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#333]'
                  }`}
                >
                  Todos os consultores
                </button>
                {filteredConsultores.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      onChangeConsultor(c.id);
                      setShowConsultor(false);
                      setConsultorSearch('');
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedConsultorId === c.id
                        ? 'bg-[#E86A2415] text-[#E86A24] font-medium'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#333]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{c.full_name || c.email}</span>
                      <span className="text-[10px] uppercase text-gray-500 dark:text-gray-400">
                        {c.status || 'consultor'}
                      </span>
                    </div>
                  </button>
                ))}
                {filteredConsultores.length === 0 && (
                  <div className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                    Nenhum consultor encontrado
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Data */}
      <div ref={dateRef} className="relative">
        <button
          onClick={() => {
            setShowDate((v) => !v);
            setShowBanca(false);
            setShowConsultor(false);
          }}
          className={buttonClass}
        >
          <Calendar className="w-4 h-4 text-[#E86A24]" />
          {DATE_FILTER_LABEL[dateFilter]}
          <ChevronDown className={`w-4 h-4 transition-transform ${showDate ? 'rotate-180' : ''}`} />
        </button>
        {showDate && (
          <div className="absolute right-0 mt-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-xl shadow-lg z-50 min-w-[220px]">
            <div className="p-2">
              {(Object.keys(DATE_FILTER_LABEL) as DateFilterKey[]).map((filter) => (
                <button
                  key={filter}
                  onClick={() => {
                    if (filter !== 'custom') {
                      onChangeDateFilter(filter);
                      setShowDate(false);
                    } else {
                      onChangeDateFilter('custom');
                    }
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    dateFilter === filter
                      ? 'bg-[#E86A2415] text-[#E86A24] font-medium'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#333]'
                  }`}
                >
                  {DATE_FILTER_LABEL[filter]}
                </button>
              ))}
              {dateFilter === 'custom' && (
                <div className="p-3 border-t border-gray-200 dark:border-[#404040] space-y-3 mt-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                      Data Inicial
                    </label>
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => onChangeCustomStartDate(e.target.value)}
                      max={customEndDate || new Date().toISOString().split('T')[0]}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-[#404040] dark:bg-[#333] dark:text-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                      Data Final
                    </label>
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => onChangeCustomEndDate(e.target.value)}
                      min={customStartDate}
                      max={new Date().toISOString().split('T')[0]}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-[#404040] dark:bg-[#333] dark:text-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24]"
                    />
                  </div>
                  <button
                    onClick={() => {
                      if (customStartDate && customEndDate) {
                        onApplyCustomDate();
                        setShowDate(false);
                      }
                    }}
                    disabled={!customStartDate || !customEndDate}
                    className="w-full bg-[#E86A24] hover:bg-[#D95E1B] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
                  >
                    Aplicar
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {rightSlot}
    </div>
  );
}
