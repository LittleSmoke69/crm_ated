'use client';

import React, { useRef, useEffect, useState, useMemo } from 'react';
import { MoreHorizontal, Plus, Loader2 } from 'lucide-react';
import { Lead } from './types';
import LeadCard from './LeadCard';

interface KanbanColumnProps {
  id: string;
  title: string;
  count: number;
  leads: Lead[];
  color: string;
  onAddLead?: (columnId: string) => void;
  onStarsChange?: (id: string | number, stars: number) => void;
  onDragStart: (e: React.DragEvent, leadId: string | number) => void;
  onDrop: (e: React.DragEvent, status: string) => void;
  targetUserId?: string;
  onTagAdded?: (leadId: string | number, addedTag: { id: string; label: string; color: string }) => void;
  onTagRemoved?: (leadId: string | number, tagId: string) => void;
  onRefresh?: () => void;
  selectedBancaUrl?: string;
  onOpenSortModal?: (columnId: string) => void;
  totalLeads?: number; // Total de leads disponíveis
  onLoadMore?: (columnId: string) => void; // Função para carregar mais leads
  isLoadingMore?: boolean; // Indica se está carregando mais leads
  /** Usar card compacto (igual CRM principal / Clientes cadastrados) para não deixar a tela grande */
  compactCards?: boolean;
  /** Prazo em dias para leads transferidos (10 na página Transferido, 90 no CRM principal) */
  transferDeadlineDays?: number;
  /** Altura máxima da área de lista (ex.: "700px") para limitar coluna e mostrar scroll após ~3 leads */
  maxListHeight?: string;
}

const KanbanColumn: React.FC<KanbanColumnProps> = ({ 
  id, 
  title, 
  count, 
  leads, 
  color,
  totalLeads,
  onLoadMore,
  isLoadingMore = false,
  onAddLead,
  onStarsChange,
  onDragStart,
  onDrop,
  targetUserId,
  onTagAdded,
  onTagRemoved,
  onRefresh,
  selectedBancaUrl,
  onOpenSortModal,
  compactCards = false,
  transferDeadlineDays = 90,
  maxListHeight,
}) => {
  const listContainerRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });
  const [scrollTop, setScrollTop] = useState(0);
  const itemHeight = 220; // Altura estimada de cada card com espaçamento
  const VIRTUALIZATION_THRESHOLD = 100; // Só virtualiza se tiver mais de 100 leads
  const ITEMS_PER_VIEW = 10; // Quantos itens renderizar por vez (com overscan)
  /** Último length conhecido: evita resetar o range ao crescer a lista (carregar mais / background). */
  const prevLengthRef = useRef(0);

  // Os leads já vêm ordenados da página principal
  const sortedLeads = leads;

  // Calcula quais leads devem ser renderizados baseado na posição do scroll
  const visibleLeads = useMemo(() => {
    if (sortedLeads.length <= VIRTUALIZATION_THRESHOLD) {
      // Retorna todos com formato consistente se não precisa virtualizar
      return sortedLeads.map((lead, index) => ({
        lead,
        index
      }));
    }

    const start = Math.max(0, visibleRange.start - 2); // Overscan: renderiza 2 itens antes
    const end = Math.min(sortedLeads.length, visibleRange.end + 2); // Overscan: renderiza 2 itens depois
    
    return sortedLeads.slice(start, end).map((lead, index) => ({
      lead,
      index: start + index
    }));
  }, [sortedLeads, visibleRange]);

  // Calcula o range visível baseado no scroll
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const scrollTop = container.scrollTop;
    setScrollTop(scrollTop);

    if (sortedLeads.length > VIRTUALIZATION_THRESHOLD) {
      const start = Math.floor(scrollTop / itemHeight);
      const end = Math.min(
        sortedLeads.length,
        start + Math.ceil(container.clientHeight / itemHeight) + ITEMS_PER_VIEW
      );
      setVisibleRange({ start, end });
    }
  };

  // Inicializa o range visível só quando necessário; ao crescer a lista (carregar mais), não reseta
  useEffect(() => {
    if (sortedLeads.length <= VIRTUALIZATION_THRESHOLD || !listContainerRef.current) {
      prevLengthRef.current = sortedLeads.length;
      return;
    }
    const prevLen = prevLengthRef.current;
    prevLengthRef.current = sortedLeads.length;
    // Só redefine para o topo quando a lista encolheu ou quando ainda não estava virtualizando
    const shouldReset = prevLen <= VIRTUALIZATION_THRESHOLD || sortedLeads.length < prevLen;
    if (shouldReset) {
      const container = listContainerRef.current;
      const end = Math.min(
        sortedLeads.length,
        Math.ceil(container.clientHeight / itemHeight) + ITEMS_PER_VIEW
      );
      setVisibleRange({ start: 0, end });
    }
  }, [sortedLeads.length, itemHeight]);
  // Map column colors to Tailwind classes or inline styles
  const getHeaderColor = () => {
    switch (color) {
      case 'gray': return 'bg-gray-100 text-gray-700';
      case 'blue': return 'bg-blue-100 text-blue-700';
      case 'green':
      case 'emerald': return 'bg-gray-100';
      case 'purple': return 'bg-purple-100 text-purple-700';
      case 'slate': return 'bg-slate-200 text-slate-700';
      case 'amber': return 'bg-amber-100 text-amber-700';
      case 'red': return 'bg-red-100 text-red-700';
      case 'rose': return 'bg-rose-100 text-rose-700';
      case 'orange': return 'bg-orange-100 text-orange-700';
      case 'indigo': return 'bg-indigo-100 text-indigo-700';
      case 'teal': return 'bg-teal-100 text-teal-700';
      case 'zinc': return 'bg-zinc-200 text-zinc-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };
  
  const getHeaderStyle = () => {
    if (color === 'green' || color === 'emerald') {
      return { color: '#8CD955', backgroundColor: '#8CD95515' };
    }
    return {};
  };

  const getBgColor = () => {
    switch (color) {
      case 'gray': return 'bg-gray-50/50';
      case 'blue': return 'bg-blue-50/50';
      case 'green':
      case 'emerald': return 'bg-gray-50/50';
      case 'purple': return 'bg-purple-50/50';
      case 'slate': return 'bg-slate-50/50';
      case 'amber': return 'bg-amber-50/50';
      case 'red': return 'bg-red-50/50';
      case 'rose': return 'bg-rose-50/50';
      case 'orange': return 'bg-orange-50/50';
      case 'indigo': return 'bg-indigo-50/50';
      case 'teal': return 'bg-teal-50/50';
      case 'zinc': return 'bg-zinc-50/50';
      default: return 'bg-gray-50/50';
    }
  };

  const getBorderColor = () => {
    switch (color) {
      case 'gray': return 'border-gray-200';
      case 'blue': return 'border-blue-200';
      case 'green':
      case 'emerald': return 'border-gray-200';
      case 'purple': return 'border-purple-200';
      case 'slate': return 'border-slate-200';
      case 'amber': return 'border-amber-200';
      case 'red': return 'border-red-200';
      case 'rose': return 'border-rose-200';
      case 'orange': return 'border-orange-200';
      case 'indigo': return 'border-indigo-200';
      case 'teal': return 'border-teal-200';
      case 'zinc': return 'border-zinc-200';
      default: return 'border-gray-200';
    }
  };

  return (
    <div 
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => onDrop(e, id)}
      className={`flex flex-col min-w-[340px] w-full max-w-[420px] h-full min-h-[500px] rounded-[32px] border-2 ${getBorderColor()} ${getBgColor()} overflow-hidden shadow-sm transition-all duration-300 hover:shadow-md`}
    >
      {/* Column Header */}
      <div className="p-6 flex items-center justify-between bg-gray-100/60 backdrop-blur-md border-b border-black/5">
        <div className="flex items-center gap-3">
          <span 
            className={`px-4 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest ${getHeaderColor()} shadow-sm border border-black/5`}
            style={getHeaderStyle()}
          >
            {title}
          </span>
          <span className="text-gray-600 text-[11px] font-black bg-white px-3 py-1.5 rounded-xl border border-gray-100 shadow-sm" title={totalLeads != null ? `${count} exibidos de ${totalLeads} no total` : undefined}>
            {totalLeads != null ? `${count}/${totalLeads}` : count}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button 
            onClick={() => onAddLead?.(id)}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-white rounded-lg transition-all"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button 
            onClick={() => onOpenSortModal?.(id)}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-white rounded-lg transition-all"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Leads List - Virtualizado para performance quando há muitos leads */}
      <div 
        ref={listContainerRef}
        className="flex-1 overflow-y-auto p-4 custom-scrollbar min-h-0"
        onScroll={handleScroll}
        style={{
          position: 'relative',
          ...(maxListHeight ? { maxHeight: maxListHeight } : {}),
        }}
      >
        {sortedLeads.length > 0 ? (
          sortedLeads.length > VIRTUALIZATION_THRESHOLD ? (
            // Virtualização customizada para muitos leads (melhor performance)
            <>
              {/* Espaçador superior para simular itens acima */}
              <div style={{ height: visibleRange.start * itemHeight, minHeight: 0 }} />
              
              {/* Renderiza apenas os leads visíveis */}
              <div style={{ position: 'relative' }}>
                {visibleLeads.map(({ lead, index }) => (
                  <div key={lead.id} style={{ marginBottom: '16px' }}>
                    <LeadCard 
                      lead={lead} 
                      onStarsChange={onStarsChange}
                      onDragStart={onDragStart}
                      targetUserId={targetUserId}
                      onTagAdded={onTagAdded}
                      onTagRemoved={onTagRemoved}
                      onRefresh={onRefresh}
                      selectedBancaUrl={selectedBancaUrl}
                      columnId={id}
                      compact={compactCards}
                      transferDeadlineDays={transferDeadlineDays}
                    />
                  </div>
                ))}
              </div>
              
              {/* Espaçador inferior para simular itens abaixo */}
              <div style={{ height: (sortedLeads.length - visibleRange.end) * itemHeight, minHeight: 0 }} />
              <div className="h-4 w-full flex-shrink-0" />
            </>
          ) : (
            // Renderização normal para poucos leads (melhor para drag and drop)
            <>
              {sortedLeads.map(lead => (
                <LeadCard 
                  key={lead.id} 
                  lead={lead} 
                  onStarsChange={onStarsChange}
                  onDragStart={onDragStart}
                  targetUserId={targetUserId}
                  onTagAdded={onTagAdded}
                  onTagRemoved={onTagRemoved}
                  onRefresh={onRefresh}
                  selectedBancaUrl={selectedBancaUrl}
                  columnId={id}
                  compact={compactCards}
                  transferDeadlineDays={transferDeadlineDays}
                />
              ))}
              <div className="h-4 w-full flex-shrink-0" />
            </>
          )
        ) : (
          <div className="h-40 flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-2xl m-2 bg-white/30">
            <div className="p-3 bg-gray-100 rounded-full mb-3">
              <Plus className="w-6 h-6 text-gray-300" />
            </div>
            <p className="text-gray-400 text-sm font-bold">Nenhum lead</p>
          </div>
        )}
        
        {/* Botão Carregar Mais */}
        {totalLeads !== undefined && totalLeads > leads.length && onLoadMore && (
          <div className="px-4 pb-4">
            <button
              onClick={() => onLoadMore(id)}
              disabled={isLoadingMore}
              className={`w-full py-3 flex items-center justify-center gap-2 text-sm font-bold rounded-xl transition-all border-2 bg-white/50 ${
                isLoadingMore
                  ? 'text-gray-400 border-gray-200 cursor-not-allowed'
                  : 'text-[#6AB83D] hover:bg-[#8CD955]/10 border-[#8CD955]/30 hover:border-[#8CD955]'
              }`}
            >
              {isLoadingMore ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Carregando...</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span>Carregar mais ({totalLeads - leads.length} leads)</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Footer / Add Lead Button */}
      <div className="p-4 bg-gray-100/40 border-t border-black/5">
        <button 
          onClick={() => onAddLead?.(id)}
          className="w-full py-3 flex items-center justify-center gap-2 text-sm font-black text-gray-500 hover:bg-white rounded-xl transition-all border border-dashed border-gray-300 hover:shadow-sm"
          style={{ '--hover-color': '#8CD955', '--hover-border': '#8CD955' } as React.CSSProperties}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#8CD955';
            e.currentTarget.style.borderColor = '#8CD955';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = '#6B7280';
            e.currentTarget.style.borderColor = '#D1D5DB';
          }}
        >
          <Plus className="w-4 h-4" />
          Novo Lead
        </button>
      </div>
    </div>
  );
};

export default KanbanColumn;

