'use client';

import React, { useRef, useEffect, useState, useMemo } from 'react';
import { MoreHorizontal, Plus, Loader2 } from 'lucide-react';
import { Lead } from './types';
import LeadCard from './LeadCard';
import { zapCard } from '@/lib/zap-card-styles';

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
  const getHeaderColor = () => {
    return 'border border-[#E86A24]/30 bg-[#E86A24]/15 text-[#E86A24]';
  };

  const getHeaderStyle = () => ({});

  const getBgColor = () => '';

  const getBorderColor = () => 'border-[#E86A24]/20';

  return (
    <div 
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => onDrop(e, id)}
      className={`${zapCard} flex h-full min-h-[500px] w-full max-w-[420px] min-w-[340px] flex-col overflow-hidden transition-all duration-300 hover:shadow-[#E86A24]/20`}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between border-b border-[#404040] bg-[#333]/60 p-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span 
            className={`rounded-xl px-4 py-1.5 text-[11px] font-black uppercase tracking-widest shadow-sm ${getHeaderColor()}`}
            style={getHeaderStyle()}
          >
            {title}
          </span>
          <span className="rounded-xl border border-[#404040] bg-[#333] px-3 py-1.5 text-[11px] font-black text-gray-300 shadow-sm" title={totalLeads != null ? `${count} exibidos de ${totalLeads} no total` : undefined}>
            {totalLeads != null ? `${count}/${totalLeads}` : count}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button 
            onClick={() => onAddLead?.(id)}
            className="rounded-lg p-1.5 text-gray-400 transition-all hover:bg-[#404040] hover:text-[#E86A24]"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button 
            onClick={() => onOpenSortModal?.(id)}
            className="rounded-lg p-1.5 text-gray-400 transition-all hover:bg-[#404040] hover:text-[#E86A24]"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Leads List - Virtualizado para performance quando há muitos leads */}
      <div 
        ref={listContainerRef}
        className="flex-1 overflow-y-auto p-4 custom-scrollbar min-h-0 bg-[#1a1a1a]/40"
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
          <div className="h-40 flex flex-col items-center justify-center border-2 border-dashed border-gray-200 dark:border-[#404040] rounded-2xl m-2 bg-white/30 dark:bg-[#2a2a2a]/50">
            <div className="p-3 bg-gray-100 rounded-full mb-3">
              <Plus className="w-6 h-6 text-gray-300" />
            </div>
            <p className="text-gray-400 dark:text-gray-500 text-sm font-bold">Nenhum lead</p>
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
                  : 'text-[#C9531A] hover:bg-[#E86A24]/10 border-[#E86A24]/30 hover:border-[#E86A24]'
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
      <div className="p-4 bg-gray-100/40 dark:bg-[#333]/50 border-t border-black/5 dark:border-[#404040]">
        <button 
          onClick={() => onAddLead?.(id)}
          className="w-full py-3 flex items-center justify-center gap-2 text-sm font-black text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-[#404040] rounded-xl transition-all border border-dashed border-gray-300 dark:border-[#555] hover:shadow-sm"
          style={{ '--hover-color': '#E86A24', '--hover-border': '#E86A24' } as React.CSSProperties}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#E86A24';
            e.currentTarget.style.borderColor = '#E86A24';
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

