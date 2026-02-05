'use client';

import React from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, Calendar, History, Award, Users, X } from 'lucide-react';

type SortField = 'created_at' | 'last_deposit_at' | 'total_ganho' | 'affiliate';
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

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal de ordenação */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md z-10 animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="p-6 bg-gradient-to-r from-[#8CD955]/10 to-[#8CD955]/5 border-b border-gray-100">
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

        {/* Ordenar por */}
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-center gap-2 px-2 py-2 mb-3">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Ordenar por</span>
          </div>
          
          <div className="space-y-2">
            <button
              onClick={() => onSortChange('created_at', sortDirection)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                sortField === 'created_at' 
                  ? 'bg-[#8CD955] text-white shadow-md hover:bg-[#7BC844]' 
                  : 'text-gray-700 hover:bg-gray-50 hover:shadow-sm border border-transparent hover:border-gray-200'
              }`}
            >
              <div className={`p-1.5 rounded-lg ${sortField === 'created_at' ? 'bg-white/20' : 'bg-gray-100'}`}>
                <Calendar className={`w-4 h-4 ${sortField === 'created_at' ? 'text-white' : 'text-gray-600'}`} />
              </div>
              <span className="flex-1 text-left">Data de cadastro</span>
              {sortField === 'created_at' && (
                <div className="flex items-center gap-1">
                  {sortDirection === 'asc' ? (
                    <ArrowUp className="w-4 h-4 text-white" />
                  ) : (
                    <ArrowDown className="w-4 h-4 text-white" />
                  )}
                </div>
              )}
            </button>
            
            <button
              onClick={() => onSortChange('last_deposit_at', sortDirection)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                sortField === 'last_deposit_at' 
                  ? 'bg-[#8CD955] text-white shadow-md hover:bg-[#7BC844]' 
                  : 'text-gray-700 hover:bg-gray-50 hover:shadow-sm border border-transparent hover:border-gray-200'
              }`}
            >
              <div className={`p-1.5 rounded-lg ${sortField === 'last_deposit_at' ? 'bg-white/20' : 'bg-gray-100'}`}>
                <History className={`w-4 h-4 ${sortField === 'last_deposit_at' ? 'text-white' : 'text-gray-600'}`} />
              </div>
              <span className="flex-1 text-left">Último depósito</span>
              {sortField === 'last_deposit_at' && (
                <div className="flex items-center gap-1">
                  {sortDirection === 'asc' ? (
                    <ArrowUp className="w-4 h-4 text-white" />
                  ) : (
                    <ArrowDown className="w-4 h-4 text-white" />
                  )}
                </div>
              )}
            </button>
            
            <button
              onClick={() => onSortChange('total_ganho', sortDirection)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                sortField === 'total_ganho' 
                  ? 'bg-[#8CD955] text-white shadow-md hover:bg-[#7BC844]' 
                  : 'text-gray-700 hover:bg-gray-50 hover:shadow-sm border border-transparent hover:border-gray-200'
              }`}
            >
              <div className={`p-1.5 rounded-lg ${sortField === 'total_ganho' ? 'bg-white/20' : 'bg-gray-100'}`}>
                <Award className={`w-4 h-4 ${sortField === 'total_ganho' ? 'text-white' : 'text-gray-600'}`} />
              </div>
              <span className="flex-1 text-left">Valor de prêmio</span>
              {sortField === 'total_ganho' && (
                <div className="flex items-center gap-1">
                  {sortDirection === 'asc' ? (
                    <ArrowUp className="w-4 h-4 text-white" />
                  ) : (
                    <ArrowDown className="w-4 h-4 text-white" />
                  )}
                </div>
              )}
            </button>
            
            <button
              onClick={() => onSortChange('affiliate', sortDirection)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                sortField === 'affiliate' 
                  ? 'bg-[#8CD955] text-white shadow-md hover:bg-[#7BC844]' 
                  : 'text-gray-700 hover:bg-gray-50 hover:shadow-sm border border-transparent hover:border-gray-200'
              }`}
            >
              <div className={`p-1.5 rounded-lg ${sortField === 'affiliate' ? 'bg-white/20' : 'bg-gray-100'}`}>
                <Users className={`w-4 h-4 ${sortField === 'affiliate' ? 'text-white' : 'text-gray-600'}`} />
              </div>
              <span className="flex-1 text-left">Total de afiliação</span>
              {sortField === 'affiliate' && (
                <div className="flex items-center gap-1">
                  {sortDirection === 'asc' ? (
                    <ArrowUp className="w-4 h-4 text-white" />
                  ) : (
                    <ArrowDown className="w-4 h-4 text-white" />
                  )}
                </div>
              )}
            </button>
          </div>
        </div>

        {/* Direção */}
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-center gap-2 px-2 py-2 mb-3">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Direção</span>
          </div>
          
          <div className="space-y-2">
            <button
              onClick={() => onSortChange(sortField, 'asc')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                sortDirection === 'asc' 
                  ? 'bg-[#8CD955] text-white shadow-md hover:bg-[#7BC844]' 
                  : 'text-gray-700 hover:bg-gray-50 hover:shadow-sm border border-transparent hover:border-gray-200'
              }`}
            >
              <div className={`p-1.5 rounded-lg ${sortDirection === 'asc' ? 'bg-white/20' : 'bg-gray-100'}`}>
                <ArrowUp className={`w-4 h-4 ${sortDirection === 'asc' ? 'text-white' : 'text-gray-600'}`} />
              </div>
              <span className="flex-1 text-left">Crescente (Padrão)</span>
              {sortDirection === 'asc' && (
                <div className="w-5 h-5 rounded-full bg-white/30 flex items-center justify-center">
                  <span className="text-white text-xs font-bold">✓</span>
                </div>
              )}
            </button>
            
            <button
              onClick={() => onSortChange(sortField, 'desc')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                sortDirection === 'desc' 
                  ? 'bg-[#8CD955] text-white shadow-md hover:bg-[#7BC844]' 
                  : 'text-gray-700 hover:bg-gray-50 hover:shadow-sm border border-transparent hover:border-gray-200'
              }`}
            >
              <div className={`p-1.5 rounded-lg ${sortDirection === 'desc' ? 'bg-white/20' : 'bg-gray-100'}`}>
                <ArrowDown className={`w-4 h-4 ${sortDirection === 'desc' ? 'text-white' : 'text-gray-600'}`} />
              </div>
              <span className="flex-1 text-left">Decrescente</span>
              {sortDirection === 'desc' && (
                <div className="w-5 h-5 rounded-full bg-white/30 flex items-center justify-center">
                  <span className="text-white text-xs font-bold">✓</span>
                </div>
              )}
            </button>
          </div>
        </div>

        {/* Botão de ação */}
        <div className="p-5 bg-gray-50">
          <button
            onClick={onApply}
            className="w-full py-3.5 px-6 bg-[#8CD955] text-white font-bold rounded-xl hover:bg-[#7BC844] transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
          >
            <ArrowUpDown className="w-5 h-5" />
            <span>Ordenar</span>
          </button>
          <p className="text-xs text-gray-500 text-center mt-3">
            A ordenação será aplicada apenas nesta coluna
          </p>
        </div>
      </div>
    </div>
  );
};

export default SortColumnModal;






