'use client';

import React, { useState, useEffect } from 'react';
import { 
  Globe, 
  Layout as LayoutIcon,
  Plus, 
  Trash2, 
  Settings, 
  RefreshCw, 
  Loader2,
  Users,
  Wallet,
  Target,
  Trophy,
  CheckCircle,
  TrendingUp,
  Calendar,
  Filter,
  Download,
  AlertCircle,
  CheckCircle2,
  Tag as TagIcon,
  Edit2
} from 'lucide-react';
import StatusDistributionChart from '@/components/Charts/StatusDistributionChart';
import TemporalEvolutionChart from '@/components/Charts/TemporalEvolutionChart';
import ConversionFunnelChart from '@/components/Charts/ConversionFunnelChart';
import ActivityByWeekdayChart from '@/components/Charts/ActivityByWeekdayChart';
import BancaRankingChart from '@/components/Charts/BancaRankingChart';

interface Banca {
  id: string;
  name: string;
  url: string;
}

interface Tag {
  id: string;
  label: string;
  color: string;
  created_at?: string;
  updated_at?: string;
}

interface DashboardMetrics {
  total_leads: number;
  total_deposited: number;
  total_bets: number;
  total_prizes: number;
  awarded_clients_count?: number;
  active_leads: number;
  conversion_rate: number;
  ltv_avg?: number;
  avg_ltv?: number; // Mantido para compatibilidade
  net_profit: number;
}

interface CRMSectionProps {
  userId: string;
}

function MetricCard({ title, value, icon, bgColor }: any) {
  const isEmerald = bgColor.includes('emerald');
  const isRose = bgColor.includes('rose');
  const isAmber = bgColor.includes('amber');
  const isPurple = bgColor.includes('purple');
  const isIndigo = bgColor.includes('indigo');
  const isTeal = bgColor.includes('teal');
  const isCyan = bgColor.includes('cyan');
  
  let gradientClass = 'from-white to-blue-50 border-blue-100';
  let dotGradientClass = 'bg-blue-600';
  let bgElementsClass = 'bg-blue-200/20';
  let bgElementsBottomClass = 'bg-blue-300/10';

  if (isEmerald) {
    gradientClass = 'from-gray-100 to-gray-50 border-gray-200';
    dotGradientClass = 'from-[#8CD955] to-[#A8E677]';
    bgElementsClass = 'bg-gray-200/20';
    bgElementsBottomClass = 'bg-gray-300/10';
  } else if (isRose) {
    gradientClass = 'from-white to-rose-50 border-rose-100';
    dotGradientClass = 'from-rose-600 to-rose-500';
    bgElementsClass = 'bg-rose-200/20';
    bgElementsBottomClass = 'bg-rose-300/10';
  } else if (isAmber) {
    gradientClass = 'from-white to-amber-50 border-amber-100';
    dotGradientClass = 'from-amber-600 to-amber-500';
    bgElementsClass = 'bg-amber-200/20';
    bgElementsBottomClass = 'bg-amber-300/10';
  } else if (isPurple) {
    gradientClass = 'from-white to-purple-50 border-purple-100';
    dotGradientClass = 'from-purple-600 to-purple-500';
    bgElementsClass = 'bg-purple-200/20';
    bgElementsBottomClass = 'bg-purple-300/10';
  } else if (isIndigo) {
    gradientClass = 'from-white to-indigo-50 border-indigo-100';
    dotGradientClass = 'from-indigo-600 to-indigo-500';
    bgElementsClass = 'bg-indigo-200/20';
    bgElementsBottomClass = 'bg-indigo-300/10';
  } else if (isTeal) {
    gradientClass = 'from-white to-teal-50 border-teal-100';
    dotGradientClass = 'from-teal-600 to-teal-500';
    bgElementsClass = 'bg-teal-200/20';
    bgElementsBottomClass = 'bg-teal-300/10';
  } else if (isCyan) {
    gradientClass = 'from-white to-cyan-50 border-cyan-100';
    dotGradientClass = 'from-cyan-600 to-cyan-500';
    bgElementsClass = 'bg-cyan-200/20';
    bgElementsBottomClass = 'bg-cyan-300/10';
  }

  return (
    <div className={`bg-gradient-to-br ${gradientClass} rounded-xl shadow-lg border p-4 sm:p-6 relative overflow-hidden h-full`}>
      <div className={`absolute top-0 right-0 w-32 h-32 ${bgElementsClass} rounded-full -mr-16 -mt-16`}></div>
      <div className={`absolute bottom-0 left-0 w-24 h-24 ${bgElementsBottomClass} rounded-full -ml-12 -mb-12`}></div>
      
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-3 sm:mb-4">
          <div className={`${bgColor} p-2 sm:p-3 rounded-lg text-white shadow-md`}>{icon}</div>
        </div>
        <div className={`text-xl sm:text-2xl font-extrabold mb-1 bg-gradient-to-r ${dotGradientClass} bg-clip-text text-transparent`}>
          {value}
        </div>
        <div className="text-[10px] sm:text-xs text-gray-500 font-bold uppercase tracking-wider">{title}</div>
      </div>
    </div>
  );
}

export default function CRMSection({ userId }: CRMSectionProps) {
  const [bancas, setBancas] = useState<Banca[]>([]);
  const [loading, setLoading] = useState(true);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Filters
  const [selectedBanca, setSelectedBanca] = useState('all');
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  
  // Dashboard Data
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [chartData, setChartData] = useState<any>(null);

  // Management Form state
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showManagement, setShowManagement] = useState(false);
  
  // Tags state
  const [tags, setTags] = useState<Tag[]>([]);
  const [newTagLabel, setNewTagLabel] = useState('');
  const [newTagColor, setNewTagColor] = useState('#8CD955');
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [isSubmittingTag, setIsSubmittingTag] = useState(false);
  const [activeTab, setActiveTab] = useState<'bancas' | 'tags'>('bancas');

  useEffect(() => {
    if (userId) {
      loadInitialData();
    }
  }, [userId]);

  useEffect(() => {
    if (userId) {
      loadDashboard();
    }
  }, [selectedBanca, dateFrom, dateTo, userId]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      const [bancasRes, tagsRes] = await Promise.all([
        fetch('/api/admin/crm/bancas', {
          headers: { 'X-User-Id': userId }
        }),
        fetch('/api/admin/crm/tags', {
          headers: { 'X-User-Id': userId }
        })
      ]);
      
      const bancasResult = await bancasRes.json();
      if (bancasResult.success) {
        setBancas(bancasResult.data);
      }
      
      const tagsResult = await tagsRes.json();
      if (tagsResult.success) {
        setTags(tagsResult.data);
      }
    } catch (err) {
      setError('Erro ao carregar dados iniciais');
    } finally {
      setLoading(false);
    }
  };

  const loadDashboard = async () => {
    try {
      setMetricsLoading(true);
      const url = new URL('/api/admin/crm/dashboard', window.location.origin);
      if (selectedBanca !== 'all') url.searchParams.append('banca_url', selectedBanca);
      // Usa date_from e date_to conforme curl especificado
      url.searchParams.append('date_from', dateFrom);
      url.searchParams.append('date_to', dateTo);

      const response = await fetch(url.toString(), {
        headers: { 'X-User-Id': userId }
      });
      const result = await response.json();
      if (result.success) {
        setMetrics(result.data.metrics);
        setChartData(result.data.chartData);
      }
    } catch (err) {
      console.error('Erro ao carregar dashboard:', err);
    } finally {
      setMetricsLoading(false);
    }
  };

  const handleAddBanca = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newUrl) return;

    try {
      setIsSubmitting(true);
      const response = await fetch('/api/admin/crm/bancas', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-User-Id': userId
        },
        body: JSON.stringify({ name: newName, url: newUrl })
      });
      
      const result = await response.json();
      if (result.success) {
        setBancas(prev => [...prev, result.data]);
        setNewName('');
        setNewUrl('');
        setSuccess('Banca adicionada com sucesso!');
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err) {
      setError('Erro ao adicionar banca');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteBanca = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir esta banca?')) return;

    try {
      const response = await fetch(`/api/admin/crm/bancas?id=${id}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId }
      });
      
      const result = await response.json();
      if (result.success) {
        setBancas(prev => prev.filter(b => b.id !== id));
        setSuccess('Banca removida com sucesso!');
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err) {
      setError('Erro ao remover banca');
    }
  };

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagLabel.trim()) return;

    try {
      setIsSubmittingTag(true);
      const url = editingTag 
        ? `/api/admin/crm/tags/${editingTag.id}`
        : '/api/admin/crm/tags';
      const method = editingTag ? 'PATCH' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 
          'Content-Type': 'application/json',
          'X-User-Id': userId
        },
        body: JSON.stringify({ label: newTagLabel.trim(), color: newTagColor })
      });
      
      const result = await response.json();
      if (result.success) {
        if (editingTag) {
          setTags(prev => prev.map(t => t.id === editingTag.id ? result.data : t));
          setEditingTag(null);
          setSuccess('Etiqueta atualizada com sucesso!');
        } else {
          setTags(prev => [...prev, result.data]);
          setSuccess('Etiqueta criada com sucesso!');
        }
        setNewTagLabel('');
        setNewTagColor('#8CD955');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(result.error || 'Erro ao salvar etiqueta');
      }
    } catch (err) {
      setError('Erro ao salvar etiqueta');
    } finally {
      setIsSubmittingTag(false);
    }
  };

  const handleEditTag = (tag: Tag) => {
    setEditingTag(tag);
    setNewTagLabel(tag.label);
    setNewTagColor(tag.color);
  };

  const handleCancelEditTag = () => {
    setEditingTag(null);
    setNewTagLabel('');
    setNewTagColor('#8CD955');
  };

  const handleDeleteTag = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir esta etiqueta?')) return;

    try {
      const response = await fetch(`/api/admin/crm/tags?id=${id}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId }
      });
      
      const result = await response.json();
      if (result.success) {
        setTags(prev => prev.filter(t => t.id !== id));
        setSuccess('Etiqueta removida com sucesso!');
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err) {
      setError('Erro ao remover etiqueta');
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 text-[#8CD955] animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Filters Header */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <select 
              value={selectedBanca}
              onChange={(e) => setSelectedBanca(e.target.value)}
              className="pl-9 pr-8 py-2 bg-gray-50 border border-gray-100 rounded-lg text-sm font-semibold text-gray-700 focus:outline-none appearance-none cursor-pointer hover:bg-gray-100 transition-colors"
            >
              <option value="all">Todas as bancas</option>
              {bancas.map(b => (
                <option key={b.id} value={b.url}>{b.name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 bg-gray-50 border border-gray-100 px-3 py-2 rounded-lg">
            <Calendar className="w-4 h-4 text-gray-400" />
            <input 
              type="date" 
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="bg-transparent text-sm font-semibold text-gray-700 focus:outline-none cursor-pointer"
            />
            <span className="text-gray-300">—</span>
            <input 
              type="date" 
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="bg-transparent text-sm font-semibold text-gray-700 focus:outline-none cursor-pointer"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowManagement(!showManagement)}
            className={`px-4 py-2 rounded-lg font-bold text-sm transition-all flex items-center gap-2 ${
              showManagement 
                ? 'bg-gray-100 text-gray-700' 
                : 'bg-[#8CD955] text-white shadow-md shadow-gray-100 hover:bg-[#7BC84A]'
            }`}
          >
            <Settings className="w-4 h-4" />
            {showManagement ? 'Ver Dashboard' : 'Gerenciar Bancas'}
          </button>
          <button 
            onClick={loadDashboard}
            disabled={metricsLoading}
            className="p-2 bg-white border border-gray-100 rounded-lg text-gray-400 hover:text-[#8CD955] transition-colors"
          >
            <RefreshCw className={`w-5 h-5 ${metricsLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-100 text-red-600 rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5" />
          <span className="font-medium text-sm">{error}</span>
        </div>
      )}

      {success && (
        <div className="p-4 bg-gray-50 border border-gray-200 text-[#6AB83D] rounded-xl flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5" />
          <span className="font-medium text-sm">{success}</span>
        </div>
      )}

      {showManagement ? (
        /* Management View */
        <div className="space-y-6">
          {/* Tabs */}
          <div className="bg-white rounded-xl p-2 border border-gray-100 shadow-sm flex gap-2">
            <button
              onClick={() => setActiveTab('bancas')}
              className={`flex-1 py-2.5 px-4 rounded-lg font-bold text-sm transition-all ${
                activeTab === 'bancas'
                  ? 'bg-[#8CD955] text-white shadow-md'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
            >
              Bancas
            </button>
            <button
              onClick={() => setActiveTab('tags')}
              className={`flex-1 py-2.5 px-4 rounded-lg font-bold text-sm transition-all ${
                activeTab === 'tags'
                  ? 'bg-[#8CD955] text-white shadow-md'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
            >
              Etiquetas
            </button>
          </div>

          {activeTab === 'bancas' ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1">
                <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
                  <h2 className="text-lg font-bold mb-6 flex items-center gap-2 text-gray-800">
                    <Plus className="w-5 h-5 text-[#8CD955]" />
                    Nova Banca
                  </h2>
              <form onSubmit={handleAddBanca} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Nome</label>
                  <input 
                    type="text" 
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Ex: Arena VIP"
                    className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:bg-white transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 ml-1">URL (Apenas Domínio)</label>
                  <input 
                    type="text" 
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    placeholder="Ex: web.girodasorte.digital"
                    className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:bg-white transition-all"
                  />
                  <p className="mt-1.5 text-[10px] text-gray-400 font-medium ml-1">
                    * Apenas o domínio, sem https:// e sem /api/crm
                  </p>
                </div>
                <button 
                  disabled={isSubmitting}
                  className="w-full bg-[#8CD955] hover:bg-[#7BC84A] text-white py-3.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-gray-100"
                >
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  CADASTRAR BANCA
                </button>
              </form>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-gray-50 bg-gray-50/30 flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-800">Bancas Cadastradas</h2>
                <span className="bg-emerald-100 text-[#6AB83D] px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider">
                  {bancas.length} Total
                </span>
              </div>
              <div className="divide-y divide-gray-50 max-h-[400px] overflow-y-auto">
                {bancas.map(b => (
                  <div key={b.id} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-all">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-center font-black text-[#8CD955]">
                        {b.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-bold text-gray-800">{b.name}</p>
                        <p className="text-xs text-gray-400 font-medium">{b.url}</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => handleDeleteBanca(b.id)}
                      className="p-2.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {bancas.length === 0 && (
                  <div className="p-12 text-center text-gray-400">
                    <Globe className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p className="font-medium text-sm">Nenhuma banca cadastrada</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
          ) : (
            /* Tags View */
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1">
                <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
                  <h2 className="text-lg font-bold mb-6 flex items-center gap-2 text-gray-800">
                    <TagIcon className="w-5 h-5 text-[#8CD955]" />
                    {editingTag ? 'Editar Etiqueta' : 'Nova Etiqueta'}
                  </h2>
                  <form onSubmit={handleAddTag} className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Nome</label>
                      <input 
                        type="text" 
                        value={newTagLabel}
                        onChange={(e) => setNewTagLabel(e.target.value)}
                        placeholder="Ex: VIP"
                        className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:bg-white transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Cor</label>
                      <div className="flex items-center gap-3">
                        <input 
                          type="color" 
                          value={newTagColor}
                          onChange={(e) => setNewTagColor(e.target.value)}
                          className="w-16 h-12 rounded-lg border border-gray-200 cursor-pointer"
                        />
                        <input 
                          type="text" 
                          value={newTagColor}
                          onChange={(e) => setNewTagColor(e.target.value)}
                          placeholder="#8CD955"
                          className="flex-1 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:bg-white transition-all"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        type="submit"
                        disabled={isSubmittingTag}
                        className="flex-1 bg-[#8CD955] hover:bg-[#7BC84A] text-white py-3.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-gray-100"
                      >
                        {isSubmittingTag ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        {editingTag ? 'ATUALIZAR' : 'CRIAR ETIQUETA'}
                      </button>
                      {editingTag && (
                        <button 
                          type="button"
                          onClick={handleCancelEditTag}
                          className="px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 py-3.5 rounded-xl font-bold text-sm transition-all"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </form>
                </div>
              </div>

              <div className="lg:col-span-2">
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-gray-50 bg-gray-50/30 flex items-center justify-between">
                    <h2 className="text-lg font-bold text-gray-800">Etiquetas Cadastradas</h2>
                    <span className="bg-emerald-100 text-[#6AB83D] px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider">
                      {tags.length} Total
                    </span>
                  </div>
                  <div className="divide-y divide-gray-50 max-h-[400px] overflow-y-auto">
                    {tags.map(tag => (
                      <div key={tag.id} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-all">
                        <div className="flex items-center gap-4">
                          <div 
                            className="w-10 h-10 rounded-xl border-2 border-gray-200 flex items-center justify-center"
                            style={{ backgroundColor: tag.color + '20' }}
                          >
                            <div 
                              className="w-6 h-6 rounded-full"
                              style={{ backgroundColor: tag.color }}
                            />
                          </div>
                          <div>
                            <p className="font-bold text-gray-800">{tag.label}</p>
                            <p className="text-xs text-gray-400 font-medium">{tag.color}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => handleEditTag(tag)}
                            className="p-2.5 text-gray-300 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleDeleteTag(tag.id)}
                            className="p-2.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                    {tags.length === 0 && (
                      <div className="p-12 text-center text-gray-400">
                        <TagIcon className="w-12 h-12 mx-auto mb-3 opacity-20" />
                        <p className="font-medium text-sm">Nenhuma etiqueta cadastrada</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Dashboard View */
        <div className="space-y-6">
          {/* KPI Rows */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard 
              title="Total de Leads" 
              value={metrics?.total_leads || 0} 
              icon={<Users className="w-5 h-5" />} 
              bgColor="bg-blue-600" 
            />
            <MetricCard 
              title="Total Depositado" 
              value={formatCurrency(metrics?.total_deposited || 0)} 
              icon={<Wallet className="w-5 h-5" />} 
              bgColor="bg-[#8CD955]" 
            />
            <MetricCard 
              title="Total Apostado" 
              value={formatCurrency(metrics?.total_bets || 0)} 
              icon={<Target className="w-5 h-5" />} 
              bgColor="bg-amber-600" 
            />
            <MetricCard 
              title="Total Premiações" 
              value={formatCurrency(metrics?.total_prizes || 0)} 
              icon={<Trophy className="w-5 h-5" />} 
              bgColor="bg-purple-600" 
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard 
              title="Leads Ativos" 
              value={metrics?.active_leads || 0} 
              icon={<CheckCircle className="w-5 h-5" />} 
              bgColor="bg-indigo-600" 
            />
            <MetricCard 
              title="Taxa Conversão" 
              value={`${(metrics?.conversion_rate || 0).toFixed(2)}%`} 
              icon={<TrendingUp className="w-5 h-5" />} 
              bgColor="bg-rose-600" 
            />
            <MetricCard 
              title="Lucro Líquido" 
              value={formatCurrency(metrics?.net_profit || 0)} 
              icon={<LayoutIcon className="w-5 h-5" />} 
              bgColor="bg-teal-600" 
            />
            <MetricCard 
              title="LTV Médio" 
              value={formatCurrency(metrics?.ltv_avg || metrics?.avg_ltv || 0)} 
              icon={<Globe className="w-5 h-5" />} 
              bgColor="bg-cyan-600" 
            />
          </div>

          {/* Charts Row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <ChartBox title="Distribuição de Leads" icon={LayoutIcon} iconColor="text-purple-500">
              {chartData?.status_distribution ? <StatusDistributionChart data={chartData.status_distribution} /> : <LoadingChart />}
            </ChartBox>

            <ChartBox title="Top 5 Consultores" icon={Trophy} iconColor="text-amber-500">
              {chartData?.top_consultants ? <BancaRankingChart data={chartData.top_consultants} prefix="R$ " /> : <LoadingChart />}
            </ChartBox>

            <ChartBox title="Lucratividade por Consultor" icon={Target} iconColor="text-[#8CD955]">
              {chartData?.consultant_profitability ? <BancaRankingChart data={chartData.consultant_profitability} prefix="R$ " /> : <LoadingChart />}
            </ChartBox>
          </div>

          {/* Charts Row 2 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <ChartBox title="Evolução Temporal" icon={TrendingUp} iconColor="text-orange-500">
              {chartData?.temporal_evolution ? <TemporalEvolutionChart data={chartData.temporal_evolution} /> : <LoadingChart />}
            </ChartBox>

            <ChartBox title="Funil de Conversão" icon={RefreshCw} iconColor="text-blue-500">
              {chartData?.conversion_funnel ? <ConversionFunnelChart data={chartData.conversion_funnel} /> : <LoadingChart />}
            </ChartBox>

            <ChartBox title="Atividade por Dia" icon={Calendar} iconColor="text-indigo-500">
              {chartData?.activity_by_weekday ? <ActivityByWeekdayChart data={chartData.activity_by_weekday} /> : <LoadingChart />}
            </ChartBox>
          </div>
        </div>
      )}
    </div>
  );
}

function ChartBox({ title, icon: Icon, iconColor, children }: { title: string, icon: any, iconColor: string, children: React.ReactNode }) {
  return (
    <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex flex-col h-[400px]">
      <h3 className="text-sm font-bold text-gray-800 mb-6 flex items-center gap-2">
        <Icon className={`w-4 h-4 ${iconColor}`} />
        {title}
      </h3>
      <div className="flex-1 min-h-0">
        {children}
      </div>
    </div>
  );
}

function LoadingChart() {
  return (
    <div className="h-full flex items-center justify-center text-gray-300 text-xs italic">
      <RefreshCw className="w-4 h-4 animate-spin mr-2" />
      Carregando...
    </div>
  );
}

