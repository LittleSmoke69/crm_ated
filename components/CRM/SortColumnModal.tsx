'use client';

import React from 'react';
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  X
} from 'lucide-react';

type SortField =
  | 'created_at'
  | 'last_deposit_at'
  | 'total_ganho'
  | 'total_afiliate'
  | 'total_depositado'
  | 'total_apostado'
  | 'total_depositos_count'
  | 'name'
  | 'last_interaction'
  | 'stars'
  | 'interactions';
type SortDirection = 'asc' | 'desc';

interface SortColumnModalProps {
  isOpen: boolean;
  onClose: () => void;
  columnTitle: string;
  sortField: SortField | null;
  sortDirection: SortDirection;
  onSortChange: (field: SortField | null, direction: SortDirection) => void;
  onApply: () => void;
}

const SORT_OPTIONS: { value: SortField; label: string; description: string }[] = [
  { value: 'created_at', label: 'Data de cadastro', description: 'Ordena pelo momento em que o lead foi cadastrado no sistema.' },
  { value: 'last_deposit_at', label: 'Último depósito', description: 'Ordena pela data do último depósito realizado pelo lead.' },
  { value: 'total_ganho', label: 'Valor de prêmio', description: 'Ordena pelo valor total de prêmios ganhos pelo lead.' },
  { value: 'total_afiliate', label: 'Total de afiliação', description: 'Ordena pela quantidade de pessoas que se cadastraram pelo link deste lead (campo total_afiliate da API).' },
  { value: 'total_depositado', label: 'Valor total depositado', description: 'Ordena pela soma de todos os depósitos realizados pelo lead.' },
  { value: 'total_apostado', label: 'Valor total apostado', description: 'Ordena pelo volume total de apostas do lead (nível de engajamento).' },
  { value: 'total_depositos_count', label: 'Quantidade de depósitos', description: 'Ordena pelo número de vezes que o lead realizou depósitos.' },
  { value: 'name', label: 'Nome', description: 'Ordena em ordem alfabética pelo nome do lead.' },
  { value: 'last_interaction', label: 'Última interação', description: 'Ordena pela data da última interação/contato com o lead.' },
  { value: 'stars', label: 'Nível/Estrelas', description: 'Ordena pelo nível ou quantidade de estrelas do lead (indicador de VIP).' },
  { value: 'interactions', label: 'Número de interações', description: 'Ordena pela quantidade total de interações/contatos realizados com o lead.' },
];

function getSortExample(field: SortField | null, direction: SortDirection): string {
  if (!field) return 'Selecione um critério de ordenação acima.';
  const asc = direction === 'asc';
  switch (field) {
    case 'created_at':
      return asc
        ? 'Exemplo: leads mais antigos primeiro (ex.: 01/01/2025 → 15/01/2025 → 06/02/2026).'
        : 'Exemplo: leads mais recentes primeiro (ex.: 06/02/2026 → 15/01/2025 → 01/01/2025).';
    case 'last_deposit_at':
      return asc
        ? 'Exemplo: quem depositou há mais tempo primeiro (ex.: há 30 dias → há 7 dias → ontem).'
        : 'Exemplo: último depósito mais recente primeiro (ex.: hoje → ontem → há 7 dias).';
    case 'total_ganho':
      return asc
        ? 'Exemplo: menores prêmios primeiro (ex.: R$ 0 → R$ 50 → R$ 1.000).'
        : 'Exemplo: maiores prêmios primeiro (ex.: R$ 1.000 → R$ 50 → R$ 0).';
    case 'total_afiliate':
      return asc
        ? 'Exemplo: menos indicações primeiro (ex.: 0 → 2 → 10 pessoas cadastradas pelo link).'
        : 'Exemplo: mais indicações primeiro (ex.: 10 → 2 → 0 pessoas cadastradas pelo link).';
    case 'total_depositado':
      return asc
        ? 'Exemplo: menores depósitos primeiro (ex.: R$ 10 → R$ 100 → R$ 5.000).'
        : 'Exemplo: maiores depósitos primeiro (ex.: R$ 5.000 → R$ 100 → R$ 10).';
    case 'total_apostado':
      return asc
        ? 'Exemplo: menos apostado primeiro (ex.: R$ 0 → R$ 50 → R$ 2.000).'
        : 'Exemplo: mais apostado primeiro (ex.: R$ 2.000 → R$ 50 → R$ 0).';
    case 'total_depositos_count':
      return asc
        ? 'Exemplo: menos depósitos primeiro (ex.: 1x → 2x → 5x → 10x).'
        : 'Exemplo: mais depósitos primeiro (ex.: 10x → 5x → 2x → 1x).';
    case 'name':
      return asc
        ? 'Exemplo: ordem A–Z (ex.: Ana → Bruno → Carlos).'
        : 'Exemplo: ordem Z–A (ex.: Carlos → Bruno → Ana).';
    case 'last_interaction':
      return asc
        ? 'Exemplo: última interação mais antiga primeiro.'
        : 'Exemplo: última interação mais recente primeiro.';
    case 'stars':
      return asc
        ? 'Exemplo: menos estrelas primeiro (ex.: 0 → 3 → 10 estrelas).'
        : 'Exemplo: mais estrelas primeiro (ex.: 10 → 3 → 0 estrelas).';
    case 'interactions':
      return asc
        ? 'Exemplo: menos interações primeiro (ex.: 0 → 2 → 15 contatos).'
        : 'Exemplo: mais interações primeiro (ex.: 15 → 2 → 0 contatos).';
    default:
      return '';
  }
}

const SortColumnModal: React.FC<SortColumnModalProps> = ({
  isOpen,
  onClose,
  columnTitle,
  sortField,
  sortDirection,
  onSortChange,
  onApply
}) => {
  if (!isOpen) return null;

  const currentOption = SORT_OPTIONS.find(o => o.value === sortField);
  const description = currentOption?.description ?? 'Escolha o critério que definirá a ordem dos leads nesta coluna.';
  const example = getSortExample(sortField, sortDirection);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden z-10 animate-in fade-in zoom-in duration-200 my-auto">
        <div className="p-6 bg-gradient-to-r from-[#8CD955]/10 to-[#8CD955]/5 border-b border-gray-100 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-[#8CD955]/20 rounded-xl">
                <ArrowUpDown className="w-5 h-5 text-[#8CD955]" />
              </div>
              <div>
                <h3 className="text-lg font-black text-gray-800">Ordenar Coluna</h3>
                <p className="text-xs text-gray-500 mt-0.5">{columnTitle}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-white rounded-lg transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
          {/* Ordenar por - Dropdown */}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Ordenar por</label>
            <div className="relative">
              <select
                value={sortField ?? ''}
                onChange={(e) => {
                  const v = e.target.value as SortField | '';
                  onSortChange(v || null, sortDirection);
                }}
                className="w-full appearance-none bg-white border-2 border-gray-200 rounded-xl px-4 py-3 pr-10 text-sm font-medium text-gray-800 focus:border-[#8CD955] focus:ring-2 focus:ring-[#8CD955]/20 outline-none transition-all"
              >
                <option value="">Selecione o critério</option>
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
            </div>
            <p className="mt-3 text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2.5 border border-gray-100">
              {description}
            </p>
          </div>

          {/* Direção */}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Direção</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onSortChange(sortField, 'asc')}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-all border-2 ${
                  sortDirection === 'asc'
                    ? 'bg-[#8CD955] text-white border-[#8CD955] shadow-md'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <ArrowUp className="w-4 h-4" />
                Crescente
              </button>
              <button
                onClick={() => onSortChange(sortField, 'desc')}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-all border-2 ${
                  sortDirection === 'desc'
                    ? 'bg-[#8CD955] text-white border-[#8CD955] shadow-md'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <ArrowDown className="w-4 h-4" />
                Decrescente
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2 px-1">
              {sortDirection === 'asc' ? 'Do menor para o maior.' : 'Do maior para o menor.'}
            </p>
          </div>

          {/* Exemplo dinâmico */}
          <div className="bg-[#8CD955]/10 rounded-xl px-4 py-3 border border-[#8CD955]/30">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">Como ficará</p>
            <p className="text-sm text-gray-800">{example}</p>
          </div>

          {/* Botão de ação */}
          <div className="pt-2">
            <button
              onClick={onApply}
              className="w-full py-3.5 px-6 bg-[#8CD955] text-white font-bold rounded-xl hover:bg-[#7BC844] transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
            >
              <ArrowUpDown className="w-5 h-5" />
              Ordenar
            </button>
            <p className="text-xs text-gray-500 text-center mt-3">
              A ordenação será aplicada apenas nesta coluna
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SortColumnModal;
