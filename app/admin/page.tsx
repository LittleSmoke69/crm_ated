'use client';

import React, { useState, useEffect } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import Pagination from '@/components/Admin/Pagination';
import { useSidebar } from '@/contexts/SidebarContext';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  LayoutDashboard,
  Users,
  UserPlus,
  Settings,
  BarChart3,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  RefreshCw,
  Calendar,
  ChevronDown,
  ChevronUp,
  Search,
  ArrowUp,
  ArrowDown,
  Plus,
  Edit,
  Trash2,
  Save,
  X,
  Menu,
  Globe,
  Layout as LayoutIcon,
  Users as UsersIcon,
  Wallet,
  Target,
  Trophy,
  CheckCircle,
  TrendingUp as TrendingUpIcon,
  Download,
  Loader2,
  Star,
  Crown,
  Eye,
  Info,
  Calendar as CalendarIcon,
  User,
  Mail,
  Lock,
  Phone,
  Building2,
  Edit as EditIcon,
  LogIn
} from 'lucide-react';
import CRMStatCard from '@/components/CRM/CRMStatCard';
import StatusDistributionChart from '@/components/Charts/StatusDistributionChart';
import TemporalEvolutionChart from '@/components/Charts/TemporalEvolutionChart';
import ConversionFunnelChart from '@/components/Charts/ConversionFunnelChart';
import ActivityByWeekdayChart from '@/components/Charts/ActivityByWeekdayChart';
import MaturadorSection from '@/components/Admin/MaturadorSection';
import { Zap } from 'lucide-react';
import BancaRankingChart from '@/components/Charts/BancaRankingChart';
import CRMSection from '@/components/Admin/CRMSection';
import EditCampaignModal, { CampaignUpdates } from '@/components/Campaigns/EditCampaignModal';

interface AdminStats {
  overview: {
    totalUsers: number;
    totalCampaigns: number;
    totalContacts: number;
    totalInstances: number;
    totalGroups: number;
  };
  campaigns: {
    total: number;
    running: number;
    paused: number;
    completed: number;
    failed: number;
    totalProcessed: number;
    totalFailed: number;
    totalAdded: number;
    successRate: number;
    strategy: any;
  };
  instances: {
    total: number;
    connected: number;
    disconnected: number;
  };
  contacts: {
    total: number;
    pending: number;
    added: number;
    sent: number;
  };
  chartData?: {
    date: string;
    adicionados: number;
    falhas: number;
  }[];
}

interface User {
  id: string;
  email: string;
  full_name: string | null;
  status: string;
  enroller: string | null;
  banca_name: string | null;
  banca_url: string | null;
  created_at: string;
  last_seen_at?: string;
  total_online_time?: number;
  settings: {
    max_leads_per_day: number;
    max_instances: number;
    is_admin: boolean;
    is_active: boolean;
  };
  stats: {
    campaigns: number;
    instances: number;
    contacts: number;
    processed: number;
    failed: number;
  };
}

interface Campaign {
  strategy: any;
  total_contacts: number;
  id: string;
  user_id: string;
  group_id: string;
  group_subject: string | null;
  status: string;
  observation?: string | null;
  processed_contacts: number;
  failed_contacts: number;
  instances?: string[];
  created_at: string;
  updated_at?: string;
  started_at: string | null;
  completed_at?: string | null;
  profiles?: {
    email: string;
    full_name: string | null;
  };
}

interface EvolutionApi {
  id: string;
  name: string;
  base_url: string;
  api_key_global: string;
  is_active: boolean;
  is_blocked_for_instances: boolean;
  description: string | null;
  user_count: number;
}

interface Proxys {
  id: string;
  name: string | null;
  host: string;
  port: string;
  username: string;
  password: string;
  protocol: string;
  enabled: boolean;
}

interface UserWithApis {
  id: string;
  email: string;
  full_name: string | null;
  evolution_apis: Array<{
    id: string;
    is_default: boolean;
    evolution_apis: EvolutionApi;
  }>;
}

interface InstanceWithProxy {
  id: string;
  instance_name: string;
  phone_number: string | null;
  status: string | null;
  proxy_instances: Array<{
    id: string;
    enabled: string;
    proxy_instances: Proxys;
  }>;
}

export default function AdminDashboard() {
  const { checking } = useRequireAuth();
  const router = useRouter();
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminStatus, setAdminStatus] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'overview' | 'users' | 'campaigns' | 'settings' | 'proxys' | 'hierarchy' | 'crm' | 'maturador'>('overview');
  const [instances, setInstances] = useState<any[]>([]);
  const [hierarchyData, setHierarchyData] = useState<any>(null);
  const [hierarchyIssues, setHierarchyIssues] = useState<any>(null);
  const [loadingHierarchy, setLoadingHierarchy] = useState(false);
  const [groups, setGroups] = useState<{ dbGroups: any[]; evolutionGroups: any[] }>({ dbGroups: [], evolutionGroups: [] });
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [finishedCampaigns, setFinishedCampaigns] = useState<Campaign[]>([]);
  const [loadingFinishedCampaigns, setLoadingFinishedCampaigns] = useState(false);
  const [instancesCurrentPage, setInstancesCurrentPage] = useState(1);
  const instancesPerPage = 10;
  const [instancesSearch, setInstancesSearch] = useState('');

  // Reset página quando busca mudar
  useEffect(() => {
    setInstancesCurrentPage(1);
  }, [instancesSearch]);
  const [groupsCurrentPage, setGroupsCurrentPage] = useState(1);
  const groupsPerPage = 5;
  const [campaignsCurrentPage, setCampaignsCurrentPage] = useState(1);
  const campaignsPerPage = 5;
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [loadingCampaignDetails, setLoadingCampaignDetails] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id =
      sessionStorage.getItem('user_id') ||
      sessionStorage.getItem('profile_id') ||
      window.localStorage.getItem('profile_id');
    setUserId(id);
  }, []);

  // Admin (não super_admin) vê Dashboard, Usuários e CRM; força seção válida
  useEffect(() => {
    if (!isSuperAdmin && adminStatus === 'admin' && activeSection !== 'overview' && activeSection !== 'users' && activeSection !== 'crm') {
      setActiveSection('overview');
    }
  }, [isSuperAdmin, adminStatus, activeSection]);

  useEffect(() => {
    if (userId) {
      checkAdminAndLoad();
    } else if (!checking) {
      router.push('/admin/login');
    }
  }, [userId, checking, router]);

  const checkAdminAndLoad = async () => {
    if (!userId) return;
    
    try {
      const response = await fetch('/api/admin/check', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
        credentials: 'include',
      });

      if (!response.ok) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      const result = await response.json();
      
      if (!result.success || !result.data?.isAdmin) {
        setIsAdmin(false);
        setLoading(false);
        setTimeout(() => router.push('/admin/login'), 1000);
        return;
      }

      setIsAdmin(true);
      setAdminStatus(result.data?.status || null);
      setIsSuperAdmin(!!result.data?.isSuperAdmin);
      await Promise.all([
        loadData(),
        loadFinishedCampaigns()
      ]);
      setLoading(false);
    } catch (error) {
      console.error('Erro ao verificar admin:', error);
      setIsAdmin(false);
      setLoading(false);
      setTimeout(() => router.push('/admin/login'), 1000);
    }
  };

  const loadData = async () => {
    try {
      const [statsRes, usersRes] = await Promise.all([
        fetch('/api/admin/stats', {
          headers: { 'X-User-Id': userId! },
        }),
        fetch('/api/admin/users', {
          headers: { 'X-User-Id': userId! },
        }),
      ]);

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData.data);
      }

      if (usersRes.ok) {
        const usersData = await usersRes.json();
        setUsers(usersData.data || []);
      }

      // Carrega instâncias e grupos
      loadInstances();
      loadGroups();
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    }
  };

  const loadInstances = async () => {
    setLoadingInstances(true);
    try {
      const res = await fetch('/api/admin/evolution/instances', {
        headers: { 'X-User-Id': userId! },
      });
      if (res.ok) {
        const data = await res.json();
        setInstances(data.data || []);
      }
    } catch (error) {
      console.error('Erro ao carregar instâncias:', error);
    } finally {
      setLoadingInstances(false);
    }
  };

  const handleDeleteInstance = async (instanceId: string, instanceName: string) => {
    if (!confirm(`Tem certeza que deseja excluir a instância "${instanceName}"? Esta ação não pode ser desfeita.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/evolution/instances/${instanceId}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId! },
      });

      const data = await res.json();

      if (res.ok && data.success) {
        alert('Instância excluída com sucesso!');
        loadInstances();
        // Ajusta página se necessário
        const totalPages = Math.ceil((instances.length - 1) / instancesPerPage);
        if (instancesCurrentPage > totalPages && totalPages > 0) {
          setInstancesCurrentPage(totalPages);
        }
      } else {
        alert(data.message || 'Erro ao excluir instância');
      }
    } catch (error) {
      console.error('Erro ao excluir instância:', error);
      alert('Erro ao excluir instância');
    }
  };

  const handleToggleMaster = async (instanceId: string, instanceName: string, currentIsMaster: boolean) => {
    const action = currentIsMaster ? 'remover o status de mestre de' : 'tornar mestre';
    if (!confirm(`Tem certeza que deseja ${action} a instância "${instanceName}"?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/evolution/instances/${instanceId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId!,
        },
        body: JSON.stringify({ is_master: !currentIsMaster }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        alert(`Instância ${currentIsMaster ? 'removida do status de mestre' : 'tornada mestre'} com sucesso!`);
        loadInstances();
      } else {
        alert(data.message || 'Erro ao atualizar instância');
      }
    } catch (error) {
      console.error('Erro ao atualizar instância:', error);
      alert('Erro ao atualizar instância');
    }
  };

  const handleViewCampaignDetails = async (campaignId: string) => {
    setLoadingCampaignDetails(true);
    setShowCampaignModal(true);
    setSelectedCampaign(null);

    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        headers: { 'X-User-Id': userId! },
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setSelectedCampaign(data.data);
      } else {
        alert(data.message || 'Erro ao carregar detalhes da campanha');
        setShowCampaignModal(false);
      }
    } catch (error) {
      console.error('Erro ao carregar detalhes da campanha:', error);
      alert('Erro ao carregar detalhes da campanha');
      setShowCampaignModal(false);
    } finally {
      setLoadingCampaignDetails(false);
    }
  };

  // Função para atualizar métricas da campanha
  const refreshCampaignMetrics = async () => {
    if (!selectedCampaign?.id || !userId) return;
    
    setLoadingCampaignDetails(true);
    try {
      const res = await fetch(`/api/campaigns/${selectedCampaign.id}`, {
        headers: { 'X-User-Id': userId },
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setSelectedCampaign(data.data);
      }
    } catch (error) {
      console.error('Erro ao atualizar métricas da campanha:', error);
    } finally {
      setLoadingCampaignDetails(false);
    }
  };

  // Polling automático para campanhas em execução
  useEffect(() => {
    if (!showCampaignModal || !selectedCampaign?.id) return;
    
    // Se a campanha estiver em execução, atualiza a cada 10 segundos
    if (selectedCampaign.status === 'running') {
      const interval = setInterval(() => {
        refreshCampaignMetrics();
      }, 10000); // Atualiza a cada 10 segundos

      return () => clearInterval(interval);
    }
  }, [showCampaignModal, selectedCampaign?.id, selectedCampaign?.status, userId]);

  const loadGroups = async () => {
    setLoadingGroups(true);
    try {
      const res = await fetch('/api/admin/evolution/groups', {
        headers: { 'X-User-Id': userId! },
      });
      if (res.ok) {
        const data = await res.json();
        setGroups({
          dbGroups: data.data?.dbGroups || [],
          evolutionGroups: data.data?.evolutionGroups || [],
        });
      }
    } catch (error) {
      console.error('Erro ao carregar grupos:', error);
    } finally {
      setLoadingGroups(false);
    }
  };

  const loadFinishedCampaigns = async () => {
    if (!userId) return;
    setLoadingFinishedCampaigns(true);
    try {
      const res = await fetch('/api/admin/campaigns', {
        headers: { 'X-User-Id': userId },
      });
      if (res.ok) {
        const data = await res.json();
        // Filtra campanhas que já rodaram (completed, failed)
        const finished = (data.data || []).filter((c: any) => 
          c.status === 'completed' || c.status === 'failed'
        );
        setFinishedCampaigns(finished);
      }
    } catch (error) {
      console.error('Erro ao carregar campanhas finalizadas:', error);
    } finally {
      setLoadingFinishedCampaigns(false);
    }
  };

  if (checking || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-[#8CD955] mx-auto mb-4" />
          <p className="text-gray-600">Carregando...</p>
        </div>
      </div>
    );
  }

  const handleSignOut = async () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      localStorage.removeItem('profile_id'); // Limpa também o localStorage
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
    }
    router.push('/admin/login');
  };

  if (!isAdmin && !loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center bg-white p-8 rounded-lg shadow-lg">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Acesso Negado</h1>
          <p className="text-gray-600 mb-4">Você não tem permissão para acessar esta área.</p>
          <button
            onClick={() => router.push('/admin/login')}
            className="px-4 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7BC84A] transition"
          >
            Fazer Login Admin
          </button>
        </div>
      </div>
    );
  }

  return (
    <Layout onSignOut={handleSignOut}>
      <div className="space-y-8 w-full">
        <div className="flex items-center justify-between gap-4 w-full">
          <div className="flex-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">Painel Administrativo</h1>
            <p className="text-sm sm:text-base text-gray-600">Gerenciamento completo do sistema</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            <button className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-white rounded-lg shadow border border-gray-200 hover:bg-gray-50 text-sm sm:text-base">
              <Calendar className="w-4 h-4" />
              <span className="hidden sm:inline">Últimos 7 dias</span>
              <span className="sm:hidden">7 dias</span>
              <ChevronDown className="w-4 h-4" />
            </button>
            {/* Botão Toggle da Sidebar - Apenas no mobile, no topo direito */}
            <div className="lg:hidden">
              <button
                onClick={() => setIsMobileOpen(!isMobileOpen)}
                className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-gray-100 transition text-gray-600 shadow-md bg-white"
                aria-label="Toggle sidebar"
              >
                <Menu className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-md p-2 flex flex-wrap gap-2">
          <button
            onClick={() => setActiveSection('overview')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg transition text-sm sm:text-base ${
              activeSection === 'overview'
                ? 'text-white'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
            style={activeSection === 'overview' ? { backgroundColor: '#8CD955' } : {}}
          >
            <LayoutDashboard className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>Dashboard</span>
          </button>

          <button
            onClick={() => setActiveSection('users')}
            className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg transition text-sm sm:text-base ${
              activeSection === 'users'
                ? 'text-white'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
            style={activeSection === 'users' ? { backgroundColor: '#8CD955' } : {}}
          >
            <Users className="w-4 h-4 sm:w-5 sm:h-5" />
            <span>Usuários</span>
          </button>

          {/* CRM: super_admin e admin */}
          {(isSuperAdmin || adminStatus === 'admin') && (
            <button
              onClick={() => setActiveSection('crm')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg transition text-sm sm:text-base ${
                activeSection === 'crm'
                  ? 'text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              style={activeSection === 'crm' ? { backgroundColor: '#8CD955' } : {}}
            >
              <LayoutIcon className="w-4 h-4 sm:w-5 sm:h-5" />
              <span>CRM</span>
            </button>
          )}

          {/* Hierarquia, Campanhas, Configurações, Proxys e Maturador: apenas super_admin */}
          {isSuperAdmin && (
            <>
              <button
                onClick={() => setActiveSection('hierarchy')}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg transition text-sm sm:text-base ${
                  activeSection === 'hierarchy'
                    ? 'text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
                style={activeSection === 'hierarchy' ? { backgroundColor: '#8CD955' } : {}}
              >
                <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5" />
                <span>Hierarquia</span>
              </button>

              <button
                onClick={() => setActiveSection('campaigns')}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg transition text-sm sm:text-base ${
                  activeSection === 'campaigns'
                    ? 'text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
                style={activeSection === 'campaigns' ? { backgroundColor: '#8CD955' } : {}}
              >
                <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5" />
                <span>Campanhas</span>
              </button>

              <button
                onClick={() => setActiveSection('settings')}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg transition text-sm sm:text-base ${
                  activeSection === 'settings'
                    ? 'text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
                style={activeSection === 'settings' ? { backgroundColor: '#8CD955' } : {}}
              >
                <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
                <span>Configurações</span>
              </button>

              <button
                onClick={() => setActiveSection('proxys')}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg transition text-sm sm:text-base ${
                  activeSection === 'proxys'
                    ? 'text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
                style={activeSection === 'proxys' ? { backgroundColor: '#8CD955' } : {}}
              >
                <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
                <span>Proxys</span>
              </button>

              <button
                onClick={() => setActiveSection('maturador')}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg transition text-sm sm:text-base ${
                  activeSection === 'maturador'
                    ? 'text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
                style={activeSection === 'maturador' ? { backgroundColor: '#8CD955' } : {}}
              >
                <Zap className="w-4 h-4 sm:w-5 sm:h-5" />
                <span>Maturador</span>
              </button>
            </>
          )}
        </div>

        <div>
          {activeSection === 'overview' && stats && (
            <div className="space-y-6 w-full">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4 w-full">
                <MetricCard
                  title="Campanhas Ativas"
                  value={stats.campaigns.running}
                  icon={<BarChart3 className="w-6 h-6" />}
                  bgColor="bg-[#8CD955]"
                />
                <MetricCard
                  title="Instâncias Conectadas"
                  value={stats.instances.connected}
                  icon={<CheckCircle2 className="w-6 h-6" />}
                  bgColor="bg-[#8CD955]"
                />
                <MetricCard
                  title="Pendentes"
                  value={stats.contacts.pending}
                  icon={<Clock className="w-6 h-6" />}
                  bgColor="bg-gray-400"
                />
                <MetricCard
                  title="Adicionados ao Grupo"
                  value={stats.contacts.added}
                  icon={<UserPlus className="w-6 h-6" />}
                  bgColor="bg-[#8CD955]"
                />
                <MetricCard
                  title="Falhas ao Adicionar"
                  value={stats.campaigns.totalFailed}
                  icon={<AlertCircle className="w-6 h-6" />}
                  bgColor="bg-gray-400"
                />
                <MetricCard
                  title="Total de Grupos Salvos"
                  value={stats.overview.totalGroups}
                  icon={<UserPlus className="w-6 h-6" />}
                  bgColor="bg-gray-400"
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 w-full">
                <div className="lg:col-span-2 bg-gradient-to-br from-white to-blue-50 rounded-xl shadow-lg border border-blue-100 p-4 sm:p-6 relative overflow-hidden">
                  {/* Decorative background elements */}
                  <div className="absolute top-0 right-0 w-32 h-32 bg-blue-200/20 rounded-full -mr-16 -mt-16"></div>
                  <div className="absolute bottom-0 left-0 w-24 h-24 bg-blue-300/10 rounded-full -ml-12 -mb-12"></div>
                  
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg sm:text-xl font-bold text-gray-800">
                        Leads Adicionados vs Falhas
                      </h2>
                      <BarChart3 className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="h-48 sm:h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={stats.chartData || []} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis
                          dataKey="date"
                          stroke="#6b7280"
                          style={{ fontSize: '12px' }}
                        />
                        <YAxis
                          stroke="#6b7280"
                          style={{ fontSize: '12px' }}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '8px',
                            padding: '8px',
                          }}
                          labelStyle={{ color: '#374151', fontWeight: 'bold' }}
                        />
                        <Legend
                          wrapperStyle={{ paddingTop: '20px' }}
                          iconType="line"
                        />
                        <Line
                          type="monotone"
                          dataKey="adicionados"
                          stroke="#10b981"
                          strokeWidth={2}
                          name="Adicionados"
                          dot={{ fill: '#10b981', r: 4 }}
                          activeDot={{ r: 6 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="falhas"
                          stroke="#ef4444"
                          strokeWidth={2}
                          name="Falhas"
                          dot={{ fill: '#ef4444', r: 4 }}
                          activeDot={{ r: 6 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-white to-emerald-50 rounded-xl shadow-lg border border-emerald-100 p-6 sm:p-8 relative overflow-hidden">
                  {/* Decorative background element */}
                  <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-200/20 rounded-full -mr-16 -mt-16"></div>
                  <div className="absolute bottom-0 left-0 w-24 h-24 bg-emerald-300/10 rounded-full -ml-12 -mb-12"></div>
                  
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-lg sm:text-xl font-bold text-gray-800">
                        Sucesso de Adição aos Grupos
                      </h2>
                      <div className={`p-2 rounded-lg ${
                        stats.campaigns.successRate >= 80 
                          ? 'bg-emerald-100' 
                          : stats.campaigns.successRate >= 50 
                          ? 'bg-yellow-100' 
                          : 'bg-red-100'
                      }`}>
                        <CheckCircle2 className={`w-5 h-5 ${
                          stats.campaigns.successRate >= 80 
                            ? 'text-[#8CD955]' 
                            : stats.campaigns.successRate >= 50 
                            ? 'text-yellow-600' 
                            : 'text-red-600'
                        }`} />
                      </div>
                    </div>
                    
                    <div className="text-center mb-6">
                      <div className="relative inline-block">
                        <div className={`text-5xl sm:text-6xl font-extrabold mb-2 bg-gradient-to-r ${
                          stats.campaigns.successRate >= 80 
                            ? 'from-[#8CD955] to-[#A8E677]' 
                            : stats.campaigns.successRate >= 50 
                            ? 'from-yellow-500 to-yellow-400' 
                            : 'from-red-500 to-red-400'
                        } bg-clip-text text-transparent`}>
                          {stats.campaigns.successRate}%
                        </div>
                        {stats.campaigns.successRate >= 80 && (
                          <TrendingUp className="w-6 h-6 text-[#8CD955] absolute -top-2 -right-8 animate-pulse" />
                        )}
                      </div>
                      <p className="text-sm text-gray-500 mt-2">
                        Taxa de sucesso nas adições
                      </p>
                    </div>
                    
                    {/* Enhanced progress bar */}
                    <div className="space-y-3">
                      <div className="w-full bg-gray-100 rounded-full h-6 shadow-inner overflow-hidden">
                        <div
                          className={`h-6 rounded-full transition-all duration-1000 ease-out relative overflow-hidden ${
                            stats.campaigns.successRate >= 80 
                              ? 'bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-500' 
                              : stats.campaigns.successRate >= 50 
                              ? 'bg-gradient-to-r from-yellow-500 via-yellow-400 to-yellow-500' 
                              : 'bg-gradient-to-r from-red-500 via-red-400 to-red-500'
                          }`}
                          style={{ width: `${Math.min(stats.campaigns.successRate, 100)}%` }}
                        >
                          <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                        </div>
                      </div>
                      
                      {/* Stats breakdown */}
                      <div className="flex justify-between items-center text-xs text-gray-600 pt-2 border-t border-gray-100">
                        <div className="flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-[#8CD955]" />
                          <span className="font-medium">{stats.contacts.added || 0} adicionados</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <XCircle className="w-3 h-3 text-red-500" />
                          <span className="font-medium">{stats.campaigns.totalFailed || 0} falhas</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 w-full">
                <div className="bg-gradient-to-br from-gray-100 to-gray-50 rounded-xl shadow-lg border border-gray-200 p-4 sm:p-6 relative overflow-hidden">
                  {/* Decorative background elements */}
                  <div className="absolute top-0 right-0 w-32 h-32 bg-purple-200/20 rounded-full -mr-16 -mt-16"></div>
                  <div className="absolute bottom-0 left-0 w-24 h-24 bg-purple-300/10 rounded-full -ml-12 -mb-12"></div>
                  
                  <div className="relative z-10">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                      <h2 className="text-lg sm:text-xl font-bold text-gray-800">Lista de Instâncias</h2>
                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <div className="relative flex-1 sm:flex-initial">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            placeholder="Buscar por nome..."
                            value={instancesSearch}
                            onChange={(e) => {
                              setInstancesSearch(e.target.value);
                              setInstancesCurrentPage(1); // Reset para primeira página ao buscar
                            }}
                            className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 w-full sm:w-64"
                          />
                        </div>
                        <button
                          onClick={loadInstances}
                          disabled={loadingInstances}
                          className="p-1.5 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
                          title="Recarregar instâncias"
                        >
                          <RefreshCw className={`w-4 h-4 ${loadingInstances ? 'animate-spin' : ''}`} />
                        </button>
                        <Settings className="w-5 h-5 text-purple-600 flex-shrink-0" />
                      </div>
                    </div>
                    {loadingInstances ? (
                      <div className="text-center py-4">
                        <RefreshCw className="w-5 h-5 animate-spin text-purple-600 mx-auto" />
                      </div>
                    ) : (
                      <div>
                        {(() => {
                          // Filtra instâncias baseado na busca
                          const filteredInstances = instances.filter((inst: any) => {
                            if (!instancesSearch.trim()) return true;
                            const searchTerm = instancesSearch.toLowerCase().trim();
                            return inst.instance_name?.toLowerCase().includes(searchTerm) ||
                                   (inst.evolution_api?.name?.toLowerCase().includes(searchTerm));
                          });

                          if (filteredInstances.length === 0) {
                            return <p className="text-sm text-gray-500">Nenhuma instância encontrada{instancesSearch ? ` para "${instancesSearch}"` : ''}</p>;
                          }

                          return (
                            <>
                              <div className="space-y-2 mb-4 max-h-[400px] overflow-y-auto">
                                {filteredInstances
                                  .slice(
                                    (instancesCurrentPage - 1) * instancesPerPage,
                                    instancesCurrentPage * instancesPerPage
                                  )
                                  .map((inst: any, i: number) => {
                                    // Verifica se a API está bloqueada
                                    const evolutionApi = Array.isArray(inst.evolution_apis) 
                                      ? inst.evolution_apis[0] 
                                      : inst.evolution_apis;
                                    const isBlocked = evolutionApi?.is_blocked_for_instances === true;
                                    
                                    return (
                                  <div
                                    key={inst.id || i}
                                    className="p-3 bg-gray-50/80 rounded-lg border border-gray-200 hover:border-purple-300 transition-colors"
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                                          <div className="font-medium text-gray-800 truncate">
                                            {inst.instance_name}
                                          </div>
                                          {inst.is_master && (
                                            <span title="Instância Mestre">
                                              <Crown className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                                            </span>
                                          )}
                                          {isBlocked && (
                                            <span
                                              className="px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800 flex items-center gap-1"
                                              title="API Evolution bloqueada para criação de novas instâncias"
                                            >
                                              <Lock className="w-3 h-3" />
                                              BLOQUEADO
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-sm text-gray-500">
                                          {inst.status}
                                          {evolutionApi && ` • ${evolutionApi.name}`}
                                        </div>
                                        {inst.sent_today > 0 && (
                                          <div className="text-xs text-gray-400 mt-1">
                                            {inst.sent_today} enviados hoje
                                          </div>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1 flex-shrink-0">
                                        <button
                                          onClick={() =>
                                            handleToggleMaster(inst.id, inst.instance_name, inst.is_master === true)
                                          }
                                          className="p-1.5 text-yellow-600 hover:bg-yellow-50 rounded-lg transition-colors"
                                          title={inst.is_master ? 'Remover status de mestre' : 'Tornar instância mestre'}
                                        >
                                          <Crown className={`w-4 h-4 ${inst.is_master ? 'fill-current' : ''}`} />
                                        </button>
                                        <button
                                          onClick={() => handleDeleteInstance(inst.id, inst.instance_name)}
                                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                          title="Excluir instância"
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                    );
                                  })}
                              </div>
                              {filteredInstances.length > instancesPerPage && (
                                <Pagination
                                  currentPage={instancesCurrentPage}
                                  totalPages={Math.ceil(filteredInstances.length / instancesPerPage)}
                                  onPageChange={setInstancesCurrentPage}
                                  itemsPerPage={instancesPerPage}
                                  totalItems={filteredInstances.length}
                                />
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-gradient-to-br from-gray-100 to-gray-50 rounded-xl shadow-lg border border-gray-200 p-4 sm:p-6 relative overflow-hidden">
                  {/* Decorative background elements */}
                  <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-200/20 rounded-full -mr-16 -mt-16"></div>
                  <div className="absolute bottom-0 left-0 w-24 h-24 bg-indigo-300/10 rounded-full -ml-12 -mb-12"></div>
                  
                  <div className="relative z-10">
                    <div className="flex justify-between items-center mb-4">
                      <h2 className="text-lg sm:text-xl font-bold text-gray-800">Grupos Salvos no Banco</h2>
                      <Users className="w-5 h-5 text-indigo-600" />
                    </div>
                    {loadingGroups ? (
                      <div className="text-center py-4">
                        <RefreshCw className="w-5 h-5 animate-spin text-indigo-600 mx-auto" />
                      </div>
                    ) : (
                      <div>
                        <div className="text-4xl sm:text-5xl font-extrabold mb-2 bg-gradient-to-r from-indigo-600 to-indigo-500 bg-clip-text text-transparent">
                          {groups.dbGroups.length}
                        </div>
                        {groups.dbGroups.length > 0 ? (
                          <>
                            <div className="text-sm text-gray-500 space-y-1 mb-4 max-h-[300px] overflow-y-auto">
                              {groups.dbGroups
                                .slice(
                                  (groupsCurrentPage - 1) * groupsPerPage,
                                  groupsCurrentPage * groupsPerPage
                                )
                                .map((g, i) => (
                                  <div key={g.id || i} className="truncate p-2 bg-gray-50/80 rounded border border-gray-200 hover:border-indigo-300 transition-colors">
                                    {g.group_subject || g.group_id}
                                  </div>
                                ))}
                            </div>
                            {groups.dbGroups.length > groupsPerPage && (
                              <Pagination
                                currentPage={groupsCurrentPage}
                                totalPages={Math.ceil(groups.dbGroups.length / groupsPerPage)}
                                onPageChange={setGroupsCurrentPage}
                                itemsPerPage={groupsPerPage}
                                totalItems={groups.dbGroups.length}
                              />
                            )}
                          </>
                        ) : (
                          <p className="text-sm text-gray-500">Nenhum grupo cadastrado</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-gradient-to-br from-gray-100 to-gray-50 rounded-xl shadow-lg border border-gray-200 p-4 sm:p-6 relative overflow-hidden">
                  {/* Decorative background elements */}
                  <div className="absolute top-0 right-0 w-32 h-32 bg-amber-200/20 rounded-full -mr-16 -mt-16"></div>
                  <div className="absolute bottom-0 left-0 w-24 h-24 bg-amber-300/10 rounded-full -ml-12 -mb-12"></div>
                  
                  <div className="relative z-10">
                    <div className="flex justify-between items-center mb-4">
                      <h2 className="text-lg sm:text-xl font-bold text-gray-800">Campanhas Finalizadas</h2>
                      <CheckCircle2 className="w-5 h-5 text-amber-600" />
                    </div>
                    {loadingFinishedCampaigns ? (
                      <div className="text-center py-4">
                        <RefreshCw className="w-5 h-5 animate-spin text-amber-600 mx-auto" />
                      </div>
                    ) : (
                      <div>
                        <div className="text-4xl sm:text-5xl font-extrabold mb-2 bg-gradient-to-r from-amber-600 to-amber-500 bg-clip-text text-transparent">
                          {finishedCampaigns.length}
                        </div>
                        {finishedCampaigns.length > 0 ? (
                          <>
                            <div className="text-sm text-gray-500 space-y-2 mb-4 max-h-[300px] overflow-y-auto">
                              {finishedCampaigns
                                .slice(
                                  (campaignsCurrentPage - 1) * campaignsPerPage,
                                  campaignsCurrentPage * campaignsPerPage
                                )
                                .map((c, i) => (
                                  <div key={c.id || i} className="flex justify-between items-center gap-2 p-2 bg-gray-50/80 rounded border border-gray-200 hover:border-amber-300 transition-colors">
                                    <div className="truncate flex-1 min-w-0" title={c.group_subject || c.group_id}>
                                      {c.group_subject || c.group_id}
                                    </div>
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                      <button
                                        onClick={() => handleViewCampaignDetails(c.id)}
                                        className="p-1 text-amber-600 hover:bg-amber-50 rounded transition-colors"
                                        title="Ver detalhes da campanha"
                                      >
                                        <Eye className="w-4 h-4" />
                                      </button>
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${
                                        c.status === 'completed' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                                      }`}>
                                        {c.status === 'completed' ? 'concluída' : c.status === 'failed' ? 'falhou' : c.status}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                            </div>
                            {finishedCampaigns.length > campaignsPerPage && (
                              <Pagination
                                currentPage={campaignsCurrentPage}
                                totalPages={Math.ceil(finishedCampaigns.length / campaignsPerPage)}
                                onPageChange={setCampaignsCurrentPage}
                                itemsPerPage={campaignsPerPage}
                                totalItems={finishedCampaigns.length}
                              />
                            )}
                          </>
                        ) : (
                          <p className="text-sm text-gray-500">Nenhuma campanha finalizada</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'users' && (
            <UsersSection users={users} onUserSelect={setSelectedUser} selectedUser={selectedUser} />
          )}

          {activeSection === 'hierarchy' && (
            <HierarchySection userId={userId} />
          )}

          {activeSection === 'crm' && userId && (
            <CRMSection userId={userId} />
          )}

          {activeSection === 'campaigns' && <CampaignsSection userId={userId} />}

          {activeSection === 'settings' && <SettingsSection />}

          {activeSection === 'proxys' && <ProxySection />}

          {activeSection === 'maturador' && <MaturadorSection userId={userId} />}
        </div>
      </div>

      {/* Modal de Detalhes da Campanha */}
      {showCampaignModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-amber-500 to-amber-600 text-white">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Target className="w-6 h-6" />
                Detalhes da Campanha
              </h2>
              <button 
                onClick={() => {
                  setShowCampaignModal(false);
                  setSelectedCampaign(null);
                }}
                className="hover:bg-white/20 p-1.5 rounded-lg transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
              {loadingCampaignDetails ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-8 h-8 animate-spin text-amber-600" />
                  <span className="ml-3 text-gray-600">Carregando detalhes...</span>
                </div>
              ) : selectedCampaign ? (
                <div className="space-y-6">
                  {/* Informações Básicas */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                      <div className="flex items-center gap-2 mb-2">
                        <Info className="w-5 h-5 text-amber-600" />
                        <h3 className="font-semibold text-gray-800">Informações Básicas</h3>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="text-gray-500">Grupo:</span>
                          <p className="font-medium text-gray-800">{selectedCampaign.group_subject || selectedCampaign.group_id || 'N/A'}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Status:</span>
                          <span className={`ml-2 px-2 py-1 rounded text-xs font-medium ${
                            selectedCampaign.status === 'completed' 
                              ? 'bg-blue-100 text-blue-700' 
                              : selectedCampaign.status === 'failed'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-gray-100 text-gray-700'
                          }`}>
                            {selectedCampaign.status === 'completed' ? 'Concluída' : selectedCampaign.status === 'failed' ? 'Falhou' : selectedCampaign.status}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                      <div className="flex items-center gap-2 mb-2">
                        <CalendarIcon className="w-5 h-5 text-amber-600" />
                        <h3 className="font-semibold text-gray-800">Datas</h3>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="text-gray-500">Criada em:</span>
                          <p className="font-medium text-gray-800">
                            {selectedCampaign.created_at 
                              ? new Date(selectedCampaign.created_at).toLocaleString('pt-BR')
                              : 'N/A'}
                          </p>
                        </div>
                        {selectedCampaign.started_at && (
                          <div>
                            <span className="text-gray-500">Iniciada em:</span>
                            <p className="font-medium text-gray-800">
                              {new Date(selectedCampaign.started_at).toLocaleString('pt-BR')}
                            </p>
                          </div>
                        )}
                        {selectedCampaign.completed_at && (
                          <div>
                            <span className="text-gray-500">Finalizada em:</span>
                            <p className="font-medium text-gray-800">
                              {new Date(selectedCampaign.completed_at).toLocaleString('pt-BR')}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Estatísticas */}
                  <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-lg p-4 border border-amber-200">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="w-5 h-5 text-amber-600" />
                        <h3 className="font-semibold text-gray-800">Estatísticas</h3>
                        {selectedCampaign.status === 'running' && (
                          <span className="text-xs text-amber-600 bg-amber-200 px-2 py-1 rounded">
                            Atualizando automaticamente...
                          </span>
                        )}
                      </div>
                      <button
                        onClick={refreshCampaignMetrics}
                        disabled={loadingCampaignDetails}
                        className="p-1.5 hover:bg-amber-200 rounded-lg transition-colors disabled:opacity-50"
                        title="Atualizar métricas"
                      >
                        <RefreshCw className={`w-4 h-4 text-amber-600 ${loadingCampaignDetails ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-gray-800">{Number(selectedCampaign.total_contacts ?? 0)}</div>
                        <div className="text-xs text-gray-600 mt-1">Total de Contatos</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-600">{Number(selectedCampaign.processed_contacts ?? 0)}</div>
                        <div className="text-xs text-gray-600 mt-1">Processados</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-600">
                          {(() => {
                            const total = Number(selectedCampaign.total_contacts ?? 0);
                            const processed = Number(selectedCampaign.processed_contacts ?? 0);
                            return total ? Math.round((processed / total) * 100) : 0;
                          })()}%
                        </div>
                        <div className="text-xs text-gray-600 mt-1">Taxa de Sucesso</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-red-600">{Number(selectedCampaign.failed_contacts ?? 0)}</div>
                        <div className="text-xs text-gray-600 mt-1">Falhas</div>
                      </div>
                    </div>
                  </div>

                  {/* Instâncias */}
                  {selectedCampaign.instances && Array.isArray(selectedCampaign.instances) && selectedCampaign.instances.length > 0 && (
                    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                      <div className="flex items-center gap-2 mb-2">
                        <Settings className="w-5 h-5 text-amber-600" />
                        <h3 className="font-semibold text-gray-800">Instâncias Utilizadas</h3>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {selectedCampaign.instances.map((inst: string, idx: number) => (
                          <span key={idx} className="px-3 py-1 bg-white rounded-lg border border-gray-300 text-sm text-gray-700">
                            {inst}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Estratégia (se disponível) */}
                  {selectedCampaign.strategy && Object.keys(selectedCampaign.strategy).length > 0 && (
                    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                      <div className="flex items-center gap-2 mb-2">
                        <Target className="w-5 h-5 text-amber-600" />
                        <h3 className="font-semibold text-gray-800">Estratégia</h3>
                      </div>
                      <pre className="text-xs bg-white p-3 rounded border border-gray-300 overflow-x-auto max-h-40 overflow-y-auto">
                        {JSON.stringify(selectedCampaign.strategy, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  Erro ao carregar detalhes da campanha
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-200 bg-gray-50 flex justify-end">
              <button
                onClick={() => {
                  setShowCampaignModal(false);
                  setSelectedCampaign(null);
                }}
                className="px-6 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

const MetricCard = ({ title, value, icon, bgColor }: any) => {
  const isEmerald = bgColor.includes('emerald');
  const isGray = bgColor.includes('gray');
  
  return (
    <div className={`bg-gradient-to-br ${isEmerald ? 'from-white to-emerald-50 border-emerald-100' : isGray ? 'from-white to-gray-50 border-gray-100' : 'from-white to-blue-50 border-blue-100'} rounded-xl shadow-lg border p-4 sm:p-6 relative overflow-hidden`}>
      {/* Decorative background elements */}
      <div className={`absolute top-0 right-0 w-32 h-32 ${isEmerald ? 'bg-emerald-200/20' : isGray ? 'bg-gray-200/20' : 'bg-blue-200/20'} rounded-full -mr-16 -mt-16`}></div>
      <div className={`absolute bottom-0 left-0 w-24 h-24 ${isEmerald ? 'bg-emerald-300/10' : isGray ? 'bg-gray-300/10' : 'bg-blue-300/10'} rounded-full -ml-12 -mb-12`}></div>
      
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-3 sm:mb-4">
          <div className={`${bgColor} p-2 sm:p-3 rounded-lg text-white shadow-md`}>{icon}</div>
        </div>
        <div className={`text-2xl sm:text-3xl font-extrabold mb-1 ${isEmerald ? 'bg-gradient-to-r from-[#8CD955] to-[#A8E677]' : isGray ? 'bg-gradient-to-r from-gray-600 to-gray-500' : 'bg-gradient-to-r from-blue-600 to-blue-500'} bg-clip-text text-transparent`}>
          {value}
        </div>
        <div className="text-xs sm:text-sm text-gray-600 font-medium">{title}</div>
      </div>
    </div>
  );
};

const UsersSection = ({ 
  users, 
  onUserSelect, 
  selectedUser 
}: { 
  users: User[]; 
  onUserSelect: (userId: string | null) => void; 
  selectedUser: string | null;
}) => {
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('todos');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortField, setSortField] = useState<keyof User | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createFormData, setCreateCreateFormData] = useState({
    email: '',
    fullName: '',
    password: '',
    status: 'consultor',
    enroller: '',
    bancaName: '',
    bancaUrl: ''
  });
  const [isCreating, setIsCreating] = useState(false);
  const itemsPerPage = 15;

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const currentUserId = sessionStorage.getItem('user_id') || sessionStorage.getItem('profile_id');
    if (!currentUserId) return;

    setIsCreating(true);
    try {
      const response = await fetch('/api/admin/users/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': currentUserId,
        },
        body: JSON.stringify(createFormData),
      });

      const result = await response.json();
      if (response.ok) {
        alert('Usuário criado com sucesso!');
        setShowCreateModal(false);
        setCreateCreateFormData({
          email: '',
          fullName: '',
          password: '',
          status: 'consultor',
          enroller: '',
          bancaName: '',
          bancaUrl: ''
        });
        window.location.reload();
      } else {
        alert(`Erro: ${result.error || 'Erro desconhecido'}`);
      }
    } catch (error) {
      console.error('Erro ao criar usuário:', error);
      alert('Erro ao criar usuário');
    } finally {
      setIsCreating(false);
    }
  };

  const handleEdit = (user: User) => {
    setEditingUser(user.id);
    setEditFormData({
      status: user.status,
      enroller: user.enroller,
      maxLeadsPerDay: user.settings.max_leads_per_day,
      maxInstances: user.settings.max_instances,
      isActive: user.settings.is_active,
      email: user.email,
      fullName: user.full_name,
      bancaName: user.banca_name || '',
      bancaUrl: user.banca_url || ''
    });
  };

  const handleCancel = () => {
    setEditingUser(null);
    setEditFormData(null);
  };

  const handleSave = async (userId: string, e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    
    const currentUserId = sessionStorage.getItem('user_id') || sessionStorage.getItem('profile_id');
    if (!currentUserId) {
      alert('Sessão inválida. Por favor, faça login novamente.');
      return;
    }
    
    if (!editFormData) {
      alert('Nenhuma alteração para salvar.');
      return;
    }
    
    setSaving(true);
    try {
      console.log('Salvando usuário:', { userId, editFormData });
      
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': currentUserId,
        },
        body: JSON.stringify({
          targetUserId: userId,
          ...editFormData
        }),
      });

      const data = await res.json();
      
      if (res.ok && data.success) {
        alert('Usuário atualizado com sucesso!');
        setEditingUser(null);
        setEditFormData(null);
        window.location.reload();
      } else {
        console.error('Erro na resposta:', data);
        alert(`Erro ao salvar: ${data.error || 'Erro desconhecido'}`);
      }
    } catch (error) {
      console.error('Erro ao salvar:', error);
      alert('Erro ao salvar configurações. Verifique o console para mais detalhes.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (userId: string, email: string) => {
    if (!confirm(`Tem certeza que deseja remover o usuário ${email}? Esta ação é irreversível.`)) return;

    const currentUserId = sessionStorage.getItem('user_id') || sessionStorage.getItem('profile_id');
    if (!currentUserId) return;

    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: {
          'X-User-Id': currentUserId,
        },
      });

      const result = await res.json();
      if (res.ok) {
        alert('Usuário removido com sucesso');
        window.location.reload();
      } else {
        alert(`Erro: ${result.error || 'Erro desconhecido'}`);
      }
    } catch (error) {
      console.error('Erro ao remover:', error);
      alert('Erro ao processar remoção');
    }
  };

  const handleImpersonate = async (targetUserId: string, userEmail: string) => {
    if (!confirm(`Deseja acessar a conta de ${userEmail}? Você será redirecionado para o dashboard deste usuário.`)) return;

    const currentUserId = sessionStorage.getItem('user_id') || sessionStorage.getItem('profile_id');
    if (!currentUserId) {
      alert('Erro: Não foi possível identificar sua sessão de admin. Por favor, faça login novamente.');
      return;
    }

    try {
      console.log('[Impersonate] Iniciando acesso à conta:', { targetUserId, userEmail, adminId: currentUserId });
      
      const res = await fetch(`/api/admin/users/${targetUserId}/impersonate`, {
        method: 'POST',
        headers: {
          'X-User-Id': currentUserId,
          'Content-Type': 'application/json',
        },
      });

      const result = await res.json();
      console.log('[Impersonate] Resposta da API:', { status: res.status, ok: res.ok, result });
      
      if (res.ok && result.success) {
        const { targetUserId: newUserId, targetEmail } = result.data;
        
        console.log('[Impersonate] Sucesso! Configurando sessão para:', { newUserId, targetEmail });
        
        // Salva o ID do admin original para poder voltar depois (opcional)
        sessionStorage.setItem('admin_original_id', currentUserId);
        
        // Limpa dados antigos primeiro
        sessionStorage.removeItem('user_id');
        sessionStorage.removeItem('profile_id');
        sessionStorage.removeItem('profile_email');
        localStorage.removeItem('profile_id');
        localStorage.removeItem('profile_email');
        
        // Limpa o cookie antigo
        document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
        
        // Aguarda um momento para garantir que os dados foram limpos
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Faz login como o usuário alvo
        sessionStorage.setItem('user_id', newUserId);
        sessionStorage.setItem('profile_id', newUserId);
        sessionStorage.setItem('profile_email', targetEmail);
        
        // Compatibilidade com localStorage
        localStorage.setItem('profile_id', newUserId);
        localStorage.setItem('profile_email', targetEmail);
        
        // Cookie de sessão
        const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
        const secureAttr = isHttps ? ' Secure;' : '';
        document.cookie = `user_id=${encodeURIComponent(newUserId)}; Path=/; SameSite=Lax;${secureAttr}`;
        
        console.log('[Impersonate] Sessão configurada, redirecionando...');
        
        // Redireciona para o dashboard
        window.location.href = '/';
      } else {
        console.error('[Impersonate] Erro na resposta:', result);
        alert(`Erro: ${result.error || 'Erro desconhecido'}`);
      }
    } catch (error) {
      console.error('[Impersonate] Erro ao acessar conta:', error);
      alert('Erro ao processar acesso à conta. Verifique o console para mais detalhes.');
    }
  };

  // Filtro por status
  let filteredUsers = users.filter(u => statusFilter === 'todos' || u.status === statusFilter);
  
  // Filtro por busca (nome, email, ID)
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase().trim();
    filteredUsers = filteredUsers.filter(u => 
      (u.full_name?.toLowerCase().includes(query)) ||
      (u.email?.toLowerCase().includes(query)) ||
      (u.id?.toLowerCase().includes(query)) ||
      (u.banca_name?.toLowerCase().includes(query))
    );
  }
  
  // Ordenação
  if (sortField) {
    filteredUsers = [...filteredUsers].sort((a, b) => {
      let aValue: any;
      let bValue: any;
      
      // Tratamento especial para diferentes campos
      switch (sortField) {
        case 'full_name':
          aValue = (a.full_name || '').toLowerCase();
          bValue = (b.full_name || '').toLowerCase();
          break;
        case 'email':
          aValue = (a.email || '').toLowerCase();
          bValue = (b.email || '').toLowerCase();
          break;
        case 'status':
          aValue = (a.status || '').toLowerCase();
          bValue = (b.status || '').toLowerCase();
          break;
        case 'created_at':
          aValue = new Date(a.created_at).getTime();
          bValue = new Date(b.created_at).getTime();
          break;
        case 'total_online_time':
          aValue = a.total_online_time || 0;
          bValue = b.total_online_time || 0;
          break;
        case 'stats':
          // Ordena pela soma de stats (campanhas + processados)
          aValue = (a.stats?.campaigns || 0) + (a.stats?.processed || 0);
          bValue = (b.stats?.campaigns || 0) + (b.stats?.processed || 0);
          break;
        default:
          aValue = a[sortField] || '';
          bValue = b[sortField] || '';
      }
      
      // Tratamento de valores nulos/undefined
      if (aValue === null || aValue === undefined) return 1;
      if (bValue === null || bValue === undefined) return -1;
      
      // Comparação
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        const comparison = aValue.localeCompare(bValue, 'pt-BR', { numeric: true, sensitivity: 'base' });
        return sortDirection === 'asc' ? comparison : -comparison;
      }
      
      // Comparação numérica
      const numComparison = aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
      return sortDirection === 'asc' ? numComparison : -numComparison;
    });
  }
  
  const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedUsers = filteredUsers.slice(startIndex, endIndex);
  
  // Handler para ordenação
  const handleSort = (field: keyof User) => {
    if (sortField === field) {
      // Se já está ordenando por este campo, inverte a direção
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Novo campo, ordena ascendente
      setSortField(field);
      setSortDirection('asc');
    }
    setCurrentPage(1); // Volta para primeira página ao ordenar
  };

  // Filtra potenciais superiores baseados no status sendo editado
  const getPotentialEnrollers = (status: string) => {
    if (status === 'consultor') return users.filter(u => u.status === 'gerente');
    if (status === 'gerente') return users.filter(u => u.status === 'dono_banca');
    if (status === 'auditoria' || status === 'suporte') return users.filter(u => u.status === 'admin');
    return [];
  };

  const formatTime = (seconds: number = 0) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const isOnline = (lastSeen?: string) => {
    if (!lastSeen) return false;
    const lastSeenDate = new Date(lastSeen);
    const now = new Date();
    // Se visto nos últimos 2 minutos, considera online
    return (now.getTime() - lastSeenDate.getTime()) < 120000;
  };

  return (
    <div className="space-y-6">
      {/* Busca */}
        <div className="bg-gray-100 p-4 rounded-xl shadow-sm border border-gray-200">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Buscar por nome, email, ID ou banca..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1); // Volta para primeira página ao buscar
            }}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Filtros de Status e Botão Criar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="bg-gray-100 p-2 rounded-xl shadow-sm border border-gray-200 flex flex-wrap gap-2">
          <button
            onClick={() => {
              setStatusFilter('todos');
              setCurrentPage(1);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${statusFilter === 'todos' ? 'bg-[#8CD955] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            Todos
          </button>
          <button
            onClick={() => {
              setStatusFilter('admin');
              setCurrentPage(1);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${statusFilter === 'admin' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}
          >
            Admins
          </button>
          <button
            onClick={() => {
              setStatusFilter('dono_banca');
              setCurrentPage(1);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${statusFilter === 'dono_banca' ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-600 hover:bg-purple-100'}`}
          >
            Donos de Banca
          </button>
          <button
            onClick={() => {
              setStatusFilter('gerente');
              setCurrentPage(1);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${statusFilter === 'gerente' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
          >
            Gerentes
          </button>
          <button
            onClick={() => {
              setStatusFilter('consultor');
              setCurrentPage(1);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${statusFilter === 'consultor' ? 'bg-[#8CD955] text-white' : 'bg-emerald-50 text-[#8CD955] hover:bg-emerald-100'}`}
          >
            Consultores
          </button>
          <button
            onClick={() => {
              setStatusFilter('auditoria');
              setCurrentPage(1);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${statusFilter === 'auditoria' ? 'bg-orange-600 text-white' : 'bg-orange-50 text-orange-600 hover:bg-orange-100'}`}
          >
            Auditoria
          </button>
          <button
            onClick={() => {
              setStatusFilter('suporte');
              setCurrentPage(1);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${statusFilter === 'suporte' ? 'bg-cyan-600 text-white' : 'bg-cyan-50 text-cyan-600 hover:bg-cyan-100'}`}
          >
            Suporte
          </button>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center justify-center gap-2 bg-[#8CD955] hover:bg-[#7BC84A] text-white px-6 py-2.5 rounded-xl font-bold transition-all shadow-md shadow-emerald-100"
        >
          <UserPlus className="w-5 h-5" />
          Cadastrar Usuário
        </button>
      </div>

      {/* Modal de Criação */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-[#8CD955] text-white">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <UserPlus className="w-6 h-6" />
                Novo Usuário
              </h2>
              <button onClick={() => setShowCreateModal(false)} className="hover:bg-white/20 p-1.5 rounded-xl transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <form onSubmit={handleCreateUser} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Nome Completo</label>
                  <input 
                    type="text" 
                    required
                    placeholder="Nome do usuário"
                    className="w-full bg-gray-50 border-gray-100 rounded-xl focus:ring-emerald-500 focus:border-emerald-500 p-3 text-sm text-gray-700"
                    value={createFormData.fullName}
                    onChange={e => setCreateCreateFormData({...createFormData, fullName: e.target.value})}
                  />
                </div>
                
                <div className="col-span-2 md:col-span-1">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">E-mail</label>
                  <input 
                    type="email" 
                    required
                    placeholder="exemplo@email.com"
                    className="w-full bg-gray-50 border-gray-100 rounded-xl focus:ring-emerald-500 focus:border-emerald-500 p-3 text-sm text-gray-700"
                    value={createFormData.email}
                    onChange={e => setCreateCreateFormData({...createFormData, email: e.target.value})}
                  />
                </div>

                <div className="col-span-2 md:col-span-1">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Senha</label>
                  <input 
                    type="password" 
                    required
                    placeholder="••••••••"
                    className="w-full bg-gray-50 border-gray-100 rounded-xl focus:ring-emerald-500 focus:border-emerald-500 p-3 text-sm text-gray-700"
                    value={createFormData.password}
                    onChange={e => setCreateCreateFormData({...createFormData, password: e.target.value})}
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Tipo de Usuário</label>
                  <select
                    className="w-full bg-gray-50 border-gray-100 rounded-xl focus:ring-emerald-500 focus:border-emerald-500 p-3 text-sm text-gray-700"
                    value={createFormData.status}
                    onChange={e => setCreateCreateFormData({...createFormData, status: e.target.value, enroller: ''})}
                  >
                    <option value="admin">Admin</option>
                    <option value="dono_banca">Dono de Banca</option>
                    <option value="gerente">Gerente</option>
                    <option value="consultor">Consultor</option>
                    <option value="auditoria">Auditoria</option>
                    <option value="suporte">Suporte</option>
                  </select>
                </div>

                {createFormData.status === 'dono_banca' && (
                  <>
                    <div className="col-span-2 md:col-span-1 animate-in slide-in-from-top-2 duration-200">
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">Nome da Banca</label>
                      <input 
                        type="text" 
                        required
                        placeholder="Ex: Banca Prime"
                        className="w-full bg-gray-50 border-gray-100 rounded-xl focus:ring-emerald-500 focus:border-emerald-500 p-3 text-sm text-gray-700"
                        value={createFormData.bancaName}
                        onChange={e => setCreateCreateFormData({...createFormData, bancaName: e.target.value})}
                      />
                    </div>
                    <div className="col-span-2 md:col-span-1 animate-in slide-in-from-top-2 duration-200">
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">URL da Banca</label>
                      <input 
                        type="url" 
                        required
                        placeholder="https://..."
                        className="w-full bg-gray-50 border-gray-100 rounded-xl focus:ring-emerald-500 focus:border-emerald-500 p-3 text-sm text-gray-700"
                        value={createFormData.bancaUrl}
                        onChange={e => setCreateCreateFormData({...createFormData, bancaUrl: e.target.value})}
                      />
                    </div>
                  </>
                )}

                {(createFormData.status === 'gerente' || createFormData.status === 'consultor') && (
                  <div className="col-span-2 animate-in slide-in-from-top-2 duration-200">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">
                      {createFormData.status === 'gerente' ? 'Selecionar Dono de Banca' : 'Selecionar Gerente'} (opcional)
                    </label>
                    <select 
                      className="w-full bg-gray-50 border-gray-100 rounded-xl focus:ring-emerald-500 focus:border-emerald-500 p-3 text-sm text-gray-700"
                      value={createFormData.enroller}
                      onChange={e => setCreateCreateFormData({...createFormData, enroller: e.target.value})}
                    >
                      <option value="">Sem superior (opcional)</option>
                      {getPotentialEnrollers(createFormData.status).map(u => (
                        <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                      ))}
                    </select>
                  </div>
                )}

                {(createFormData.status === 'auditoria' || createFormData.status === 'suporte') && (
                  <div className="col-span-2 animate-in slide-in-from-top-2 duration-200">
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">
                      Selecionar Admin (Opcional)
                    </label>
                    <select 
                      className="w-full bg-gray-50 border-gray-100 rounded-xl focus:ring-emerald-500 focus:border-emerald-500 p-3 text-sm text-gray-700"
                      value={createFormData.enroller}
                      onChange={e => setCreateCreateFormData({...createFormData, enroller: e.target.value})}
                    >
                      <option value="">Sem superior (pode ser NULL)</option>
                      {users.filter(u => u.status === 'admin').map(u => (
                        <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="pt-4 flex gap-3">
                <button 
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold py-3 rounded-xl transition-all"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  disabled={isCreating}
                  className="flex-2 bg-[#8CD955] hover:bg-[#7BC84A] text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-emerald-100 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isCreating ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  ) : (
                    <>
                      <Plus className="w-5 h-5" />
                      Criar Usuário
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="bg-gradient-to-br from-white to-emerald-50 rounded-xl shadow-lg border border-emerald-100 overflow-hidden relative">
        {/* Decorative background elements */}
        <div className="absolute top-0 right-0 w-40 h-40 bg-emerald-200/20 rounded-full -mr-20 -mt-20"></div>
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-emerald-300/10 rounded-full -ml-16 -mb-16"></div>
        
        <div className="p-4 sm:p-6 relative z-10">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <Users className="w-6 h-6 text-[#8CD955]" />
              <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Gestão de Usuários</h2>
            </div>
            <span className="text-sm text-gray-600 font-medium bg-gray-50/80 px-3 py-1 rounded-lg border border-gray-200">{filteredUsers.length} usuários encontrados</span>
          </div>
          
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[1000px]">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th 
                    className="text-left p-4 text-gray-700 text-xs font-bold uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors select-none"
                    onClick={() => handleSort('full_name')}
                  >
                    <div className="flex items-center gap-2">
                      Usuário / ID
                      {sortField === 'full_name' && (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                      )}
                    </div>
                  </th>
                  <th 
                    className="text-left p-4 text-gray-700 text-xs font-bold uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors select-none"
                    onClick={() => handleSort('status')}
                  >
                    <div className="flex items-center gap-2">
                      Status / Superior
                      {sortField === 'status' && (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                      )}
                    </div>
                  </th>
                  <th 
                    className="text-center p-4 text-gray-700 text-xs font-bold uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors select-none"
                    onClick={() => handleSort('total_online_time')}
                  >
                    <div className="flex items-center justify-center gap-2">
                      Tempo Online
                      {sortField === 'total_online_time' && (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                      )}
                    </div>
                  </th>
                  <th className="text-center p-4 text-gray-700 text-xs font-bold uppercase tracking-wider">Limites</th>
                  <th 
                    className="text-center p-4 text-gray-700 text-xs font-bold uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors select-none"
                    onClick={() => handleSort('stats')}
                  >
                    <div className="flex items-center justify-center gap-2">
                      Estatísticas
                      {sortField === 'stats' && (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                      )}
                    </div>
                  </th>
                  <th className="text-right p-4 text-gray-700 text-xs font-bold uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginatedUsers.map((user: User) => (
                  <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                    <td className="p-4">
                      {editingUser === user.id ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={editFormData.fullName || ''}
                            onChange={e => setEditFormData({...editFormData, fullName: e.target.value})}
                            placeholder="Nome Completo"
                            className="w-full px-2 py-1 text-sm border rounded text-gray-700"
                          />
                          <input
                            type="email"
                            value={editFormData.email || ''}
                            onChange={e => setEditFormData({...editFormData, email: e.target.value})}
                            placeholder="Email"
                            className="w-full px-2 py-1 text-sm border rounded text-gray-700"
                          />
                        </div>
                      ) : (
                        <div>
                          <div className="font-bold text-gray-800 text-sm">{user.full_name || 'Sem nome'}</div>
                          <div className="text-xs text-gray-500">{user.email}</div>
                          <div className="text-[10px] text-gray-400 mt-1 font-mono">{user.id}</div>
                        </div>
                      )}
                    </td>
                    <td className="p-4">
                      {editingUser === user.id ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                          <select
                            value={editFormData.status}
                            onChange={e => setEditFormData({...editFormData, status: e.target.value, enroller: null})}
                              className="flex-1 px-2 py-1 text-sm border rounded text-gray-700 font-bold"
                          >
                            <option value="admin">Admin</option>
                            <option value="dono_banca">Dono de Banca</option>
                            <option value="gerente">Gerente</option>
                            <option value="consultor">Consultor</option>
                            <option value="auditoria">Auditoria</option>
                            <option value="suporte">Suporte</option>
                          </select>
                            <button
                              type="button"
                              onClick={() => setEditFormData({...editFormData, isActive: !editFormData.isActive})}
                              className={`px-2 py-1 rounded text-[10px] font-bold transition-colors ${
                                editFormData.isActive ? 'bg-green-600 text-white' : 'bg-gray-400 text-white'
                              }`}
                            >
                              {editFormData.isActive ? 'ATIVO' : 'INATIVO'}
                            </button>
                          </div>
                          {(editFormData.status === 'gerente' || editFormData.status === 'consultor') && (
                            <select
                              value={editFormData.enroller || ''}
                              onChange={e => setEditFormData({...editFormData, enroller: e.target.value || null})}
                              className="w-full px-2 py-1 text-sm border rounded text-gray-700"
                            >
                              <option value="">Sem superior</option>
                              {getPotentialEnrollers(editFormData.status).map(pe => (
                                <option key={pe.id} value={pe.id}>{pe.full_name || pe.email}</option>
                              ))}
                            </select>
                          )}
                          {(editFormData.status === 'auditoria' || editFormData.status === 'suporte') && (
                            <select
                              value={editFormData.enroller || ''}
                              onChange={e => setEditFormData({...editFormData, enroller: e.target.value || null})}
                              className="w-full px-2 py-1 text-sm border rounded text-gray-700"
                            >
                              <option value="">Sem superior (pode ser NULL)</option>
                              {getPotentialEnrollers(editFormData.status).map(pe => (
                                <option key={pe.id} value={pe.id}>{pe.full_name || pe.email}</option>
                              ))}
                            </select>
                          )}
                          {editFormData.status === 'dono_banca' && (
                            <div className="space-y-1 mt-2">
                              <input
                                type="text"
                                value={editFormData.bancaName || ''}
                                onChange={e => setEditFormData({...editFormData, bancaName: e.target.value})}
                                placeholder="Nome da Banca"
                                className="w-full px-2 py-1 text-[10px] border rounded text-gray-700"
                              />
                              <input
                                type="url"
                                value={editFormData.bancaUrl || ''}
                                onChange={e => setEditFormData({...editFormData, bancaUrl: e.target.value})}
                                placeholder="URL da Banca"
                                className="w-full px-2 py-1 text-[10px] border rounded text-gray-700"
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                          <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            user.status === 'admin' ? 'bg-red-100 text-red-700' :
                            user.status === 'dono_banca' ? 'bg-purple-100 text-purple-700' :
                            user.status === 'gerente' ? 'bg-blue-100 text-blue-700' :
                            user.status === 'auditoria' ? 'bg-orange-100 text-orange-700' :
                            user.status === 'suporte' ? 'bg-cyan-100 text-cyan-700' :
                            'bg-emerald-100 text-emerald-700'
                          }`}>
                            {user.status}
                          </span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${user.settings?.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                              {user.settings?.is_active ? 'ATIVO' : 'INATIVO'}
                            </span>
                          </div>
                          {user.status === 'dono_banca' && user.banca_name && (
                            <div className="text-[10px] text-purple-600 mt-1 font-bold">
                              Banca: {user.banca_name}
                            </div>
                          )}
                          {user.enroller && (
                            <div className="text-[10px] text-gray-500 mt-1 flex items-center gap-1">
                              <TrendingUp className="w-3 h-3" />
                              Superior: {users.find(u => u.id === user.enroller)?.full_name || users.find(u => u.id === user.enroller)?.email || 'ID: ' + user.enroller.substring(0,8)}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="text-center">
                        <div className="flex items-center justify-center gap-1.5 mb-1">
                          <div className={`w-2 h-2 rounded-full ${isOnline(user.last_seen_at) ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`}></div>
                          <span className={`text-xs font-bold ${isOnline(user.last_seen_at) ? 'text-green-600' : 'text-gray-500'}`}>
                            {isOnline(user.last_seen_at) ? 'Online' : 'Offline'}
                          </span>
                        </div>
                        <div className="text-sm font-black text-gray-800" title="Tempo total acumulado">
                          {formatTime(user.total_online_time)}
                        </div>
                        {user.last_seen_at && (
                          <div className="text-[9px] text-gray-400 mt-1 uppercase font-bold">
                            Visto: {new Date(user.last_seen_at).toLocaleDateString('pt-BR')} {new Date(user.last_seen_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      {editingUser === user.id ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-400 w-12 uppercase font-bold">Leads:</span>
                            <input
                              type="number"
                              value={editFormData.maxLeadsPerDay}
                              onChange={e => setEditFormData({...editFormData, maxLeadsPerDay: parseInt(e.target.value)})}
                              className="w-full px-2 py-1 text-sm border rounded text-gray-700"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-400 w-12 uppercase font-bold">WAs:</span>
                            <input
                              type="number"
                              value={editFormData.maxInstances}
                              onChange={e => setEditFormData({...editFormData, maxInstances: parseInt(e.target.value)})}
                              className="w-full px-2 py-1 text-sm border rounded text-gray-700"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="text-center">
                          <div className="text-xs font-bold text-gray-700">{user.settings?.max_leads_per_day} Leads/Dia</div>
                          <div className="text-[10px] text-gray-500">{user.settings?.max_instances} Instâncias</div>
                        </div>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-center">
                        <div>
                          <div className="text-[10px] text-gray-400 uppercase font-bold">Camps</div>
                          <div className="text-xs font-bold text-gray-700">{user.stats.campaigns}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-gray-400 uppercase font-bold">Sucesso</div>
                          <div className="text-xs font-bold text-[#8CD955]">{user.stats.processed}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-gray-400 uppercase font-bold">WAs</div>
                          <div className="text-xs font-bold text-blue-600">{user.stats.instances}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-gray-400 uppercase font-bold">Falhas</div>
                          <div className="text-xs font-bold text-red-600">{user.stats.failed}</div>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex flex-col gap-2 items-end">
                        {editingUser === user.id ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={(e) => handleSave(user.id, e)}
                              disabled={saving}
                              className="p-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7BC84A] disabled:opacity-50 transition-colors"
                              title="Salvar"
                            >
                              {saving ? (
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                              ) : (
                                <Save className="w-4 h-4" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleCancel();
                              }}
                              disabled={saving}
                              className="p-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 transition-colors"
                              title="Cancelar"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleImpersonate(user.id, user.email)}
                              className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 border border-blue-100"
                              title="Acessar Conta"
                            >
                              <LogIn className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleEdit(user)}
                              className="p-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 border border-gray-200"
                              title="Editar Usuário"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(user.id, user.email)}
                              className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 border border-red-100"
                              title="Remover Usuário"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                            {user.status === 'consultor' && (
                              <a
                                href={`/crm/kanban?userId=${user.id}`}
                                className="p-2 bg-emerald-50 text-[#8CD955] rounded-lg hover:bg-emerald-100 border border-emerald-100"
                                title="Visualizar CRM"
                              >
                                <BarChart3 className="w-4 h-4" />
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        
        {totalPages > 1 && (
          <div className="p-4 bg-gray-50 border-t border-gray-100">
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              itemsPerPage={itemsPerPage}
              totalItems={filteredUsers.length}
            />
          </div>
        )}
      </div>
    </div>
  );
};

const CampaignsSection = ({ userId }: { userId: string | null }) => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [instances, setInstances] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (userId) {
      loadCampaigns();
      loadInstances();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const loadCampaigns = async () => {
    if (!userId) return;
    
    setLoading(true);
    try {
      const res = await fetch('/api/admin/campaigns', {
        headers: { 'X-User-Id': userId },
      });
      if (res.ok) {
        const data = await res.json();
        setCampaigns(data.data || []);
      }
    } catch (error) {
      console.error('Erro ao carregar campanhas:', error);
    } finally {
      setLoading(false);
    }
  };

  // Polling automático para atualizar campanhas em execução
  // Dispara o processamento da fila antes de recarregar para que processados/falhas atualizem
  useEffect(() => {
    if (!userId) return;

    const hasRunningCampaigns = campaigns.some(c => c.status === 'running');

    if (hasRunningCampaigns) {
      const interval = setInterval(() => {
        // Dispara processamento da fila (worker/cron) para atualizar processados/falhas no banco
        fetch('/api/campaigns/trigger-queue', { method: 'POST', headers: { 'X-User-Id': userId } }).catch(() => {});
        loadCampaigns();
      }, 15000);

      return () => clearInterval(interval);
    }
  }, [campaigns, userId]);

  const loadInstances = async () => {
    if (!userId) return;
    
    try {
      const res = await fetch('/api/instances', {
        headers: { 'X-User-Id': userId },
      });
      if (res.ok) {
        const data = await res.json();
        setInstances(data.data || []);
      }
    } catch (error) {
      console.error('Erro ao carregar instâncias:', error);
    }
  };

  const handleUpdateCampaign = async (campaignId: string, updates: CampaignUpdates & { status?: string }) => {
    if (!userId) return;
    
    setSaving(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
        body: JSON.stringify(updates),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        // Se foi apenas mudança de status (especialmente pausar), não fecha o modal
        if (updates.status && Object.keys(updates).length === 1) {
          // Atualiza a campanha no estado local sem fechar o modal
          setEditingCampaign(prev => prev ? { ...prev, status: updates.status || prev.status } : null);
          await loadCampaigns();
        } else {
          // Para outras atualizações, fecha o modal
          alert('Campanha atualizada com sucesso!');
          setEditingCampaign(null);
          await loadCampaigns();
        }
      } else {
        alert(`Erro: ${data.error || 'Erro desconhecido'}`);
      }
    } catch (error) {
      console.error('Erro ao atualizar campanha:', error);
      alert('Erro ao atualizar campanha');
    } finally {
      setSaving(false);
    }
  };

  const handleCheckInstances = async (campaignId: string) => {
    if (!userId) return;
    
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/check-instances`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-User-Id': userId 
        },
      });

      const data = await res.json();
      if (res.ok && data.success) {
        return data.data;
      } else {
        alert(`Erro: ${data.error || 'Erro desconhecido'}`);
        return null;
      }
    } catch (error) {
      console.error('Erro ao verificar instâncias:', error);
      alert('Erro ao verificar instâncias');
      return null;
    }
  };

  if (loading) {
    return <div className="bg-gray-100 rounded-xl shadow p-6 border border-gray-200">Carregando...</div>;
  }

  const totalPages = Math.ceil(campaigns.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedCampaigns = campaigns.slice(startIndex, endIndex);

  return (
    <div className="bg-gradient-to-br from-white to-blue-50 rounded-xl shadow-lg border border-blue-100 overflow-hidden relative">
      {/* Decorative background elements */}
      <div className="absolute top-0 right-0 w-40 h-40 bg-blue-200/20 rounded-full -mr-20 -mt-20"></div>
      <div className="absolute bottom-0 left-0 w-32 h-32 bg-blue-300/10 rounded-full -ml-16 -mb-16"></div>
      
      <div className="p-4 sm:p-6 relative z-10">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 sm:mb-6">
          <div className="flex items-center gap-3">
            <BarChart3 className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Todas as Campanhas</h2>
          </div>
          <button
            onClick={loadCampaigns}
            className="px-3 sm:px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 text-sm sm:text-base shadow-md shadow-blue-100 transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            Atualizar
          </button>
        </div>
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left p-3 sm:p-4 text-gray-700 text-sm sm:text-base">ID</th>
                <th className="text-left p-3 sm:p-4 text-gray-700 text-sm sm:text-base">Usuário</th>
                <th className="text-left p-3 sm:p-4 text-gray-700 text-sm sm:text-base">Grupo / Instância</th>
                <th className="text-left p-3 sm:p-4 text-gray-700 text-sm sm:text-base">Status</th>
                <th className="text-left p-3 sm:p-4 text-gray-700 text-sm sm:text-base">Timer</th>
                <th className="text-left p-3 sm:p-4 text-gray-700 text-sm sm:text-base">Pendentes</th>
                <th className="text-left p-3 sm:p-4 text-gray-700 text-sm sm:text-base">Processados</th>
                <th className="text-left p-3 sm:p-4 text-gray-700 text-sm sm:text-base">Falhas</th>
                <th className="text-left p-3 sm:p-4 text-gray-700 text-sm sm:text-base">Início / Criação</th>
                <th className="text-left p-3 sm:p-4 text-gray-700 text-sm sm:text-base">Ações</th>
              </tr>
            </thead>
            <tbody>
              {paginatedCampaigns.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-gray-500">
                    Nenhuma campanha encontrada
                  </td>
                </tr>
              ) : (
                paginatedCampaigns.map((campaign) => (
                  <tr key={campaign.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="p-3 sm:p-4 text-xs sm:text-sm text-gray-600">{campaign.id.substring(0, 8)}...</td>
                    <td className="p-3 sm:p-4 text-sm sm:text-base text-gray-600">{campaign.profiles?.email || 'N/A'}</td>
                    <td className="p-3 sm:p-4 text-sm sm:text-base text-gray-600">
                      <div className="flex flex-col">
                        <span className="font-bold">{campaign.group_subject || campaign.group_id}</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {campaign.instances && campaign.instances.length > 0 ? (
                            campaign.instances.map((inst, idx) => (
                              <span key={idx} className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-100 font-bold">
                                {inst}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] text-gray-400 italic font-bold">Nenhuma instância</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="p-3 sm:p-4">
                      <div className="flex flex-col gap-1">
                        <span
                          className={`px-2 py-1 rounded text-xs w-fit ${
                            campaign.status === 'running'
                              ? 'bg-emerald-100 text-emerald-800'
                              : campaign.status === 'completed'
                              ? 'bg-blue-100 text-blue-800'
                              : campaign.status === 'failed'
                              ? 'bg-red-100 text-red-800'
                              : campaign.status === 'paused'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {campaign.status}
                        </span>
                        {campaign.status === 'failed' && campaign.observation && (
                          <span className="text-[10px] text-red-600 font-medium max-w-[150px] leading-tight break-words" title={campaign.observation}>
                            Obs: {campaign.observation}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 sm:p-4 text-sm sm:text-base text-gray-600">{campaign.strategy?.delayConfig?.delayValue || 'N/A'}</td>
                    <td className="p-3 sm:p-4 text-sm sm:text-base text-gray-600">
                      {Math.max(0, (campaign.total_contacts ?? 0) - ((campaign.processed_contacts ?? 0) + (campaign.failed_contacts ?? 0)))}
                    </td>
                    <td className="p-3 sm:p-4 text-sm sm:text-base text-gray-600">{Number(campaign.processed_contacts ?? 0)}</td>
                    <td className="p-3 sm:p-4 text-sm sm:text-base text-gray-600">{Number(campaign.failed_contacts ?? 0)}</td>
                    <td className="p-3 sm:p-4 text-[10px] sm:text-xs text-gray-600">
                      <div className="flex flex-col gap-1">
                        {campaign.started_at ? (
                          <div className="flex items-center gap-1 text-[#8CD955] font-bold">
                            <Clock className="w-3 h-3" />
                            <span>{new Date(campaign.started_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        ) : (
                          <span className="text-gray-400 italic">Não iniciada</span>
                        )}
                        <div className="text-gray-400">
                          Criação: {new Date(campaign.created_at).toLocaleDateString('pt-BR')}
                        </div>
                      </div>
                    </td>
                    <td className="p-3 sm:p-4">
                      <button
                        onClick={() => setEditingCampaign(campaign)}
                        className="px-3 py-1.5 bg-[#8CD955] hover:bg-[#7BC84A] text-white rounded-lg text-sm font-medium transition flex items-center gap-2"
                        title="Editar Campanha"
                      >
                        <Edit className="w-4 h-4" />
                        Editar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Edição */}
      {editingCampaign && (
        <EditCampaignModal
          campaign={editingCampaign}
          instances={instances}
          isOpen={!!editingCampaign}
          onClose={() => setEditingCampaign(null)}
          onSave={async (campaignId, updates) => {
            await handleUpdateCampaign(campaignId, updates);
          }}
          onCheckInstances={handleCheckInstances}
          onCampaignUpdated={(campaignId, newStatus) => {
            // Atualiza o estado local da campanha para que o botão desapareça
            setEditingCampaign(prev => prev ? { ...prev, status: newStatus } : null);
          }}
          showToast={(message, type) => {
            if (type === 'success') {
              alert(message);
            } else {
              alert(message);
            }
          }}
        />
      )}
      {campaigns.length > itemsPerPage && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          itemsPerPage={itemsPerPage}
          totalItems={campaigns.length}
        />
      )}
    </div>
  );
};

const SettingsSection = () => {
  const [apis, setApis] = useState<EvolutionApi[]>([]);
  const [usersWithApis, setUsersWithApis] = useState<UserWithApis[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingApi, setEditingApi] = useState<EvolutionApi | null>(null);
  const router = useRouter();
  const [formData, setFormData] = useState({
    name: '',
    base_url: '',
    api_key_global: '',
    description: '',
    is_active: true,
    is_blocked_for_instances: false,
  });
  

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const userId = sessionStorage.getItem('user_id') || sessionStorage.getItem('profile_id');
      const [apisRes, usersRes] = await Promise.all([
        fetch('/api/admin/evolution-apis', {
          headers: { 'X-User-Id': userId || '' },
        }),
        fetch('/api/admin/evolution-apis/users', {
          headers: { 'X-User-Id': userId || '' },
        })
      ]);

      if (apisRes.ok) {
        const apisData = await apisRes.json();
        setApis(apisData.data || []);
      }

      if (usersRes.ok) {
        const usersData = await usersRes.json();
        setUsersWithApis(usersData.data || []);
      }
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const userId = sessionStorage.getItem('user_id') || sessionStorage.getItem('profile_id');
    
    if (!userId) {
      alert('Sessão inválida. Faça login novamente.');
      return;
    }

    if (!formData.name.trim() || !formData.base_url.trim() || !formData.api_key_global.trim()) {
      alert('Preencha todos os campos obrigatórios (Nome, URL Base e API Key)');
      return;
    }

    try {
      const url = editingApi
        ? `/api/admin/evolution-apis/${editingApi.id}`
        : '/api/admin/evolution-apis';
      
      const method = editingApi ? 'PATCH' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
        body: JSON.stringify({
          ...formData,
          description: formData.description.trim() || null,
        }),
      });

      if (res.ok) {
        setShowAddModal(false);
        setEditingApi(null);
        setFormData({ name: '', base_url: '', api_key_global: '', description: '', is_active: true, is_blocked_for_instances: false });
        await loadData();
      } else {
        const error = await res.json();
        alert(`Erro: ${error.error || 'Erro desconhecido'}`);
      }
    } catch (error) {
      console.error('Erro ao salvar:', error);
      alert('Erro ao salvar API. Verifique sua conexão e tente novamente.');
    }
  };

  const handleEdit = (api: EvolutionApi) => {
    setEditingApi(api);
    setFormData({
      name: api.name,
      base_url: api.base_url,
      api_key_global: api.api_key_global,
      description: api.description || '',
      is_active: api.is_active,
      is_blocked_for_instances: api.is_blocked_for_instances || false,
    });
    setShowAddModal(true);
  };

  const handleDelete = async (apiId: string) => {
    if (!confirm('Tem certeza que deseja deletar esta API? Isso removerá todas as atribuições de usuários.')) {
      return;
    }

    const userId = sessionStorage.getItem('user_id') || sessionStorage.getItem('profile_id');
    
    if (!userId) {
      alert('Sessão inválida. Faça login novamente.');
      return;
    }
    
    try {
      const res = await fetch(`/api/admin/evolution-apis/${apiId}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId },
      });

      if (res.ok) {
        await loadData();
      } else {
        const error = await res.json();
        alert(`Erro: ${error.error || 'Erro desconhecido'}`);
      }
    } catch (error) {
      console.error('Erro ao deletar:', error);
      alert('Erro ao deletar API. Verifique sua conexão e tente novamente.');
    }
  };

  const handleToggleBlock = async (api: EvolutionApi) => {
    const userId = sessionStorage.getItem('user_id') || sessionStorage.getItem('profile_id');
    
    if (!userId) {
      alert('Sessão inválida. Faça login novamente.');
      return;
    }

    const newBlockedStatus = !api.is_blocked_for_instances;
    const action = newBlockedStatus ? 'bloquear' : 'desbloquear';
    
    if (!confirm(`Tem certeza que deseja ${action} esta API para criação de instâncias? A API ainda poderá ser usada para adicionar pessoas em grupos e enviar mensagens.`)) {
      return;
    }
    
    try {
      const res = await fetch(`/api/admin/evolution-apis/${api.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
        body: JSON.stringify({
          is_blocked_for_instances: newBlockedStatus,
        }),
      });

      if (res.ok) {
        await loadData();
      } else {
        const error = await res.json();
        alert(`Erro: ${error.error || 'Erro desconhecido'}`);
      }
    } catch (error) {
      console.error('Erro ao alterar bloqueio:', error);
      alert('Erro ao alterar bloqueio. Verifique sua conexão e tente novamente.');
    }
  };

  const handleAssignUser = async (apiId: string, userId: string, isDefault: boolean) => {
    const adminUserId = sessionStorage.getItem('user_id') || sessionStorage.getItem('profile_id');
    if (!adminUserId) return;
    
    try {
      const res = await fetch(`/api/admin/evolution-apis/${apiId}/assign-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': adminUserId,
        },
        body: JSON.stringify({ user_id: userId, is_default: isDefault }),
      });

      if (res.ok) {
        await loadData();
      } else {
        const error = await res.json();
        console.error('Erro ao atribuir usuário:', error);
        alert(`Erro: ${error.error || 'Erro desconhecido'}`);
      }
    } catch (error) {
      console.error('Erro ao atribuir usuário:', error);
      alert('Erro ao atribuir usuário');
    }
  };

  const handleUnassignUser = async (apiId: string, userId: string) => {
    const adminUserId = sessionStorage.getItem('user_id') || sessionStorage.getItem('profile_id');
    if (!adminUserId) return;
    
    try {
      const res = await fetch(`/api/admin/evolution-apis/${apiId}/assign-user?user_id=${userId}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': adminUserId },
      });

      if (res.ok) {
        return;
      } else {
        const error = await res.json();
        console.error('Erro ao remover atribuição:', error);
        throw new Error(error.error || 'Erro desconhecido');
      }
    } catch (error) {
      console.error('Erro ao remover atribuição:', error);
      throw error;
    }
  };

  if (loading) {
    return <div className="bg-gray-100 rounded-xl shadow p-6 border border-gray-200">Carregando...</div>;
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="bg-gradient-to-br from-white to-violet-50 rounded-xl shadow-lg border border-violet-100 p-4 sm:p-6 relative overflow-hidden">
        {/* Decorative background elements */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-violet-200/20 rounded-full -mr-16 -mt-16"></div>
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-violet-300/10 rounded-full -ml-12 -mb-12"></div>
        
        <div className="relative z-10">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Settings className="w-5 h-5 text-violet-600" />
                <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Chat Interno</h2>
              </div>
              <p className="text-sm text-gray-600 mt-1">
                Gerencie as instâncias exclusivas usadas pelo chat interno (webhook, eventos e conexão).
              </p>
            </div>
            <button
              onClick={() => router.push('/admin/chat-instances')}
              className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 text-sm sm:text-base w-full sm:w-auto shadow-md shadow-violet-100 transition-all"
            >
              <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
              Gerenciar Instâncias de Chat
            </button>
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-br from-white to-cyan-50 rounded-xl shadow-lg border border-cyan-100 p-4 sm:p-6 relative overflow-hidden">
        {/* Decorative background elements */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-200/20 rounded-full -mr-16 -mt-16"></div>
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-cyan-300/10 rounded-full -ml-12 -mb-12"></div>
        
        <div className="relative z-10">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 sm:mb-6">
            <div className="flex items-center gap-2">
              <Settings className="w-6 h-6 text-cyan-600" />
              <h2 className="text-xl sm:text-2xl font-bold text-gray-800">APIs Evolution</h2>
            </div>
            <button
              onClick={() => {
                setEditingApi(null);
                setFormData({ name: '', base_url: '', api_key_global: '', description: '', is_active: true, is_blocked_for_instances: false });
                setShowAddModal(true);
              }}
              className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 text-sm sm:text-base w-full sm:w-auto shadow-md shadow-cyan-100 transition-all"
            >
              <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
              Adicionar API
            </button>
          </div>

          <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left p-3 sm:p-4 text-gray-700 text-sm sm:text-base">Nome</th>
                <th className="text-left p-3 sm:p-4 text-gray-700 text-sm sm:text-base">URL Base</th>
                <th className="text-left p-3 sm:p-4 text-gray-700 text-sm sm:text-base">Status</th>
                <th className="text-left p-3 sm:p-4 text-gray-700 text-sm sm:text-base">Usuários</th>
                <th className="text-left p-3 sm:p-4 text-gray-700 text-sm sm:text-base">Ações</th>
              </tr>
            </thead>
            <tbody>
              {apis.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-gray-500">
                    Nenhuma API configurada
                  </td>
                </tr>
              ) : (
                apis.map((api) => (
                  <tr key={api.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="p-3 sm:p-4">
                      <div className="font-medium text-gray-800 text-sm sm:text-base">{api.name}</div>
                      {api.description && (
                        <div className="text-xs sm:text-sm text-gray-500">{api.description}</div>
                      )}
                    </td>
                    <td className="p-3 sm:p-4 text-xs sm:text-sm text-gray-600 break-all">{api.base_url}</td>
                    <td className="p-3 sm:p-4">
                      <div className="flex flex-col gap-1">
                        <span
                          className={`px-2 py-1 rounded text-xs ${
                            api.is_active
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {api.is_active ? 'Ativa' : 'Inativa'}
                        </span>
                        {api.is_blocked_for_instances && (
                          <span className="px-2 py-1 rounded text-xs bg-orange-100 text-orange-800">
                            Bloqueada para Instâncias
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 sm:p-4 text-sm sm:text-base">{api.user_count}</td>
                    <td className="p-3 sm:p-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleToggleBlock(api)}
                          className={`p-2 rounded ${
                            api.is_blocked_for_instances
                              ? 'text-orange-600 hover:bg-orange-50'
                              : 'text-gray-600 hover:bg-gray-50'
                          }`}
                          title={api.is_blocked_for_instances ? 'Desbloquear para criação de instâncias' : 'Bloquear para criação de instâncias'}
                        >
                          <Lock className={`w-4 h-4 ${api.is_blocked_for_instances ? '' : 'opacity-50'}`} />
                        </button>
                        <button
                          onClick={() => handleEdit(api)}
                          className="p-2 text-[#8CD955] hover:bg-emerald-50 rounded"
                          title="Editar"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(api.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded"
                          title="Deletar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        </div>
      </div>

      

      <div className="bg-gradient-to-br from-white to-slate-50 rounded-xl shadow-lg border border-slate-100 p-4 sm:p-6 relative overflow-hidden">
        {/* Decorative background elements */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-slate-200/20 rounded-full -mr-16 -mt-16"></div>
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-slate-300/10 rounded-full -ml-12 -mb-12"></div>
        
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-4 sm:mb-6">
            <Users className="w-5 h-5 sm:w-6 sm:h-6 text-slate-600" />
            <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Atribuir Usuários às APIs</h2>
          </div>
          <div className="space-y-4">
            {usersWithApis.map((user) => (
              <div key={user.id} className="bg-gray-50/80 rounded-lg border border-gray-200 p-3 sm:p-4">
              <div className="flex flex-col sm:flex-row justify-between items-start gap-3 mb-3">
                <div className="flex-1">
                  <div className="font-medium text-gray-800 text-sm sm:text-base">{user.email}</div>
                  <div className="text-xs sm:text-sm text-gray-500">{user.full_name || 'Sem nome'}</div>
                </div>
                <select
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 w-full sm:w-auto"
                  value={user.evolution_apis.find(ua => ua.is_default)?.evolution_apis?.id || ''}
                  onChange={async (e) => {
                    const apiId = e.target.value;
                    try {
                      if (apiId) {
                        for (const ua of user.evolution_apis) {
                          try {
                            await handleUnassignUser(ua.evolution_apis.id, user.id);
                          } catch (err) {
                            console.error('Erro ao remover atribuição:', err);
                          }
                        }
                        await handleAssignUser(apiId, user.id, true);
                      } else {
                        for (const ua of user.evolution_apis) {
                          try {
                            await handleUnassignUser(ua.evolution_apis.id, user.id);
                          } catch (err) {
                            console.error('Erro ao remover atribuição:', err);
                          }
                        }
                        await loadData();
                      }
                    } catch (error) {
                      console.error('Erro ao processar atribuição:', error);
                      alert('Erro ao processar atribuição. Tente novamente.');
                    }
                  }}
                >
                  <option value="">Selecione uma API</option>
                  {apis.filter(api => api.is_active).map((api) => (
                    <option key={api.id} value={api.id}>
                      {api.name}
                    </option>
                  ))}
                </select>
              </div>
              {user.evolution_apis.length > 0 && (
                <div className="text-sm text-gray-600">
                  APIs atribuídas: {user.evolution_apis.map(ua => ua.evolution_apis.name).join(', ')}
                </div>
              )}
            </div>
          ))}
          </div>
        </div>
      </div>


      
      {showAddModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-100 rounded-xl shadow-lg p-4 sm:p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-gray-200">
            <div className="flex justify-between items-center mb-4 sm:mb-6">
              <h3 className="text-lg sm:text-xl font-semibold text-gray-800">
                {editingApi ? 'Editar API Evolution' : 'Adicionar API Evolution'}
              </h3>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setEditingApi(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nome *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  URL Base *
                </label>
                <input
                  type="url"
                  value={formData.base_url}
                  onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700"
                  placeholder="https://evolution.example.com/"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  API Key (Master Key) *
                </label>
                <input
                  type="text"
                  value={formData.api_key_global}
                  onChange={(e) => setFormData({ ...formData, api_key_global: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Descrição
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700"
                  rows={3}
                />
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  className="w-4 h-4 text-[#8CD955] border-gray-300 rounded focus:ring-emerald-500"
                />
                <label htmlFor="is_active" className="ml-2 text-sm text-gray-700">
                  API Ativa
                </label>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="is_blocked_for_instances"
                  checked={formData.is_blocked_for_instances}
                  onChange={(e) => setFormData({ ...formData, is_blocked_for_instances: e.target.checked })}
                  className="w-4 h-4 text-orange-600 border-gray-300 rounded focus:ring-orange-500"
                />
                <label htmlFor="is_blocked_for_instances" className="ml-2 text-sm text-gray-700">
                  Bloqueada para Criação de Instâncias
                  <span className="block text-xs text-gray-500 mt-1">
                    (A API ainda poderá ser usada para adicionar pessoas em grupos e enviar mensagens)
                  </span>
                </label>
              </div>

              <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingApi(null);
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm sm:text-base"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7BC84A] flex items-center justify-center gap-2 text-sm sm:text-base"
                >
                  <Save className="w-4 h-4" />
                  {editingApi ? 'Salvar Alterações' : 'Criar API'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
    </div>
  );
};

const ProxySection = () => {
  const [proxys, setProxys] = useState<Proxys[]>([]);
  const [editingProxy, setEditingProxy] = useState<Proxys | null>(null);  
  const [intancesWithProxy, setInstancesWithProxy] = useState<InstanceWithProxy[]>([]);
  const [showAddModalProxy, setShowAddModalProxy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [formDataProxy, setFormDataProxy] = useState({
    name: '',
    host: '',
    port: '',
    username: '',
    password: '',
    protocol: '',
  });

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const userId = sessionStorage.getItem('user_id') || sessionStorage.getItem('profile_id');
      const [ proxyRes, instanceRes] = await Promise.all([
        fetch('/api/admin/proxy', {
          headers: { 'X-User-Id': userId || '' },
        }),
        fetch('/api/admin/proxy/users', {
          headers: { 'X-User-Id': userId || '' },
        }),
      ]);

      if (proxyRes.ok) {
        const proxyData = await proxyRes.json();
        setProxys(proxyData.data || []);
      }

      if (instanceRes.ok) {
        const instanceData = await instanceRes.json();
        setInstancesWithProxy(instanceData.data || []);
      }
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitProxy = async (e: React.FormEvent) => {
    e.preventDefault();
    const userId = sessionStorage.getItem('user_id') || sessionStorage.getItem('profile_id');
    
    if (!userId) {
      alert('Sessão inválida. Faça login novamente.');
      return;
    }
    console.log(formDataProxy)
    if (!formDataProxy.name.trim() || !formDataProxy.host.trim() || !formDataProxy.port.trim() || !formDataProxy.password.trim() || !formDataProxy.username.trim()) {
      alert('Preencha todos os campos obrigatórios (Nome, Host, Porta, Usuario, Senha)');
      return;
    }

    try {
      const url = editingProxy
        ? `/api/admin/proxy/${editingProxy.id}`
        : '/api/admin/proxy';
      
      const method = editingProxy ? 'PATCH' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
        body: JSON.stringify({
          formDataProxy
        }),
      });

      if (res.ok) {
        setShowAddModalProxy(false);
        setEditingProxy(null);
        setFormDataProxy({ name: '', host: '', port: '', username: '', password: '', protocol: '' });
        await loadData();
      } else {
        const error = await res.json();
        alert(`Erro: ${error.error || 'Erro desconhecido'}`);
      }
    } catch (error) {
      console.error('Erro ao salvar:', error);
      alert('Erro ao salvar API. Verifique sua conexão e tente novamente.');
    }
  };

  const handleEditProxy = (api: Proxys) => {
    setEditingProxy(api);
    setFormDataProxy({
      name: api.name || '',
      host: api.host,
      port: api.port,
      username: api.username,
      password: api.password,
      protocol: api.protocol,
    });
    setShowAddModalProxy(true);
  };

  const handleDelete = async (apiId: string) => {
    if (!confirm('Tem certeza que deseja deletar esta Proxy? Isso removerá todas as atribuições de usuários.')) {
      return;
    }

    const userId = sessionStorage.getItem('user_id') || sessionStorage.getItem('profile_id');
    
    if (!userId) {
      alert('Sessão inválida. Faça login novamente.');
      return;
    }
    
    try {
      const res = await fetch(`/api/admin/proxy/${apiId}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId },
      });

      if (res.ok) {
        await loadData();
      } else {
        const error = await res.json();
        alert(`Erro: ${error.error || 'Erro desconhecido'}`);
      }
    } catch (error) {
      console.error('Erro ao deletar:', error);
      alert('Erro ao deletar Proxy. Verifique sua conexão e tente novamente.');
    }
  };

    const handleAssignInstance = async (apiId: string, userId: string, isDefault: boolean) => {
    const adminUserId = sessionStorage.getItem('user_id') || sessionStorage.getItem('profile_id');
    if (!adminUserId) return;
    
    try {
      const res = await fetch(`/api/admin/proxy/${apiId}/assign-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': adminUserId,
        },
        body: JSON.stringify({ user_id: userId, is_default: isDefault }),
      });

      if (res.ok) {
        await loadData();
      } else {
        const error = await res.json();
        console.error('Erro ao atribuir usuário:', error);
        alert(`Erro: ${error.error || 'Erro desconhecido'}`);
      }
    } catch (error) {
      console.error('Erro ao atribuir usuário:', error);
      alert('Erro ao atribuir usuário');
    }
  };

  const handleUnassignUser = async (apiId: string, userId: string) => {
    const adminUserId = sessionStorage.getItem('user_id') || sessionStorage.getItem('profile_id');
    if (!adminUserId) return;
    
    try {
      const res = await fetch(`/api/admin/evolution-apis/${apiId}/assign-user?user_id=${userId}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': adminUserId },
      });

      if (res.ok) {
        return;
      } else {
        const error = await res.json();
        console.error('Erro ao remover atribuição:', error);
        throw new Error(error.error || 'Erro desconhecido');
      }
    } catch (error) {
      console.error('Erro ao remover atribuição:', error);
      throw error;
    }
  };

  if (loading) {
    return <div className="bg-gray-100 rounded-xl shadow p-6 border border-gray-200">Carregando...</div>;
  }
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="bg-gradient-to-br from-white to-emerald-50 rounded-xl shadow-lg border border-emerald-100 p-4 sm:p-6 relative overflow-hidden">
        {/* Decorative background elements */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-200/20 rounded-full -mr-16 -mt-16"></div>
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-emerald-300/10 rounded-full -ml-12 -mb-12"></div>
        
        <div className="relative z-10">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 sm:mb-6">
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 sm:w-6 sm:h-6 text-[#8CD955]" />
              <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Proxys Evolution</h2>
            </div>
          <button
            onClick={() => {
              setEditingProxy(null);
              setFormDataProxy({ name: '', host: '', port: '', password: '', username: '', protocol: '' });
              setShowAddModalProxy(true);
            }}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7BC84A] text-sm sm:text-base w-full sm:w-auto"
          >
            <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
            Adicionar Proxy
          </button>
        </div>

        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left p-3 sm:p-4 text-gray-700 text-sm sm:text-base">Nome</th>
                <th className="text-left p-3 sm:p-4 text-gray-700 text-sm sm:text-base">Host</th>
                <th className="text-left p-3 sm:p-4 text-gray-700 text-sm sm:text-base">Port</th>
                <th className="text-left p-3 sm:p-4 text-gray-700 text-sm sm:text-base">Protocol</th>
                <th className="text-left p-3 sm:p-4 text-gray-700 text-sm sm:text-base">Username</th>
                <th className="text-left p-3 sm:p-4 text-gray-700 text-sm sm:text-base">Status</th>
                <th className="text-left p-3 sm:p-4 text-gray-700 text-sm sm:text-base">Ações</th>
              </tr>
            </thead>
            <tbody>
              {proxys.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-gray-500">
                    Nenhuma Proxy configurada
                  </td>
                </tr>
              ) : (
                proxys.map((proxy) => (
                  <tr key={proxy.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="p-3 sm:p-4">
                      <div className="font-medium text-gray-800 text-sm sm:text-base">{proxy.name || 'Sem nome'}</div>
                    </td>
                    <td className="p-3 sm:p-4">
                      <div className="text-gray-600 text-sm sm:text-base">{proxy.host}</div>
                    </td>
                    <td className="p-3 sm:p-4 text-xs sm:text-sm text-gray-600 break-all">{proxy.port}</td>
                    <td className="p-3 sm:p-4 text-xs sm:text-sm text-gray-600 break-all">{proxy.protocol}</td>
                    <td className="p-3 sm:p-4 text-xs sm:text-sm text-gray-600 break-all">{proxy.username}</td>
                    <td className="p-3 sm:p-4">
                      <span
                        className={`px-2 py-1 rounded text-xs ${
                          proxy.enabled
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {proxy.enabled ? 'Ativa' : 'Inativa'}
                      </span>
                    </td>
                    <td className="p-3 sm:p-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEditProxy(proxy)}
                          className="p-2 text-[#8CD955] hover:bg-emerald-50 rounded"
                          title="Editar"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(proxy.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded"
                          title="Deletar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        </div>
      </div>
      <div className="bg-gradient-to-br from-white to-emerald-50 rounded-xl shadow-lg border border-emerald-100 p-4 sm:p-6 relative overflow-hidden">
        {/* Decorative background elements */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-200/20 rounded-full -mr-16 -mt-16"></div>
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-emerald-300/10 rounded-full -ml-12 -mb-12"></div>
        
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-4 sm:mb-6">
            <Users className="w-5 h-5 sm:w-6 sm:h-6 text-[#8CD955]" />
            <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Atribuir Instancias aos Proxys</h2>
          </div>
          <div className="space-y-4">
            {intancesWithProxy.map((instance) => (
              <div key={instance.id} className="bg-gray-50/80 rounded-lg border border-gray-200 p-3 sm:p-4">
              <div className="flex flex-col sm:flex-row justify-between items-start gap-3 mb-3">
                <div className="flex-1">
                  <div className="font-medium text-gray-800 text-sm sm:text-base">{instance.instance_name}</div>
                </div>
                <select
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 w-full sm:w-auto"
                  value={instance.proxy_instances.find(ua => ua.enabled)?.proxy_instances?.id || ''}
                  onChange={async (e) => {
                    const proxyId = e.target.value;
                    try {
                      if (proxyId) {
                        for (const ua of instance.proxy_instances) {
                          try {
                            await handleUnassignUser(ua.proxy_instances.id, instance.id);
                          } catch (err) {
                            console.error('Erro ao remover atribuição:', err);
                          }
                        }
                        await handleAssignInstance(proxyId, instance.id, true);
                      } else {
                        for (const ua of instance.proxy_instances) {
                          try {
                            await handleUnassignUser(ua.proxy_instances.id, instance.id);
                          } catch (err) {
                            console.error('Erro ao remover atribuição:', err);
                          }
                        }
                        await loadData();
                      }
                    } catch (error) {
                      console.error('Erro ao processar atribuição:', error);
                      alert('Erro ao processar atribuição. Tente novamente.');
                    }
                  }}
                >
                  <option value="">Selecione um Proxy</option>
                  {proxys.filter(proxy => proxy.enabled).map((proxy) => (
                    <option key={proxy.id} value={proxy.id}>
                      {proxy.name || proxy.host}
                    </option>
                  ))}
                </select>
              </div>
              {instance.proxy_instances.length > 0 && (
                <div className="text-sm text-gray-600">
                  Proxies atribuídos: {instance.proxy_instances.map(pi => pi.proxy_instances.name || pi.proxy_instances.host).join(', ')}
                </div>
              )}
            </div>
          ))}
          </div>
        </div>
      </div>
      {showAddModalProxy && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-100 rounded-xl shadow-lg p-4 sm:p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-gray-200">
            <div className="flex justify-between items-center mb-4 sm:mb-6">
              <h3 className="text-lg sm:text-xl font-semibold text-gray-800">
                {editingProxy ? 'Editar Proxy' : 'Adicionar Proxy'}
              </h3>
              <button
                onClick={() => {
                  setShowAddModalProxy(false);
                  setEditingProxy(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>
            </div>

            <form onSubmit={handleSubmitProxy} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nome (Identificação) *
                </label>
                <input
                  type="text"
                  value={formDataProxy.name}
                  onChange={(e) => setFormDataProxy({ ...formDataProxy, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700"
                  placeholder="Ex: Proxy Premium 01"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Host *
                </label>
                <input
                  type="text"
                  value={formDataProxy.host}
                  onChange={(e) => setFormDataProxy({ ...formDataProxy, host: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Porta *
                </label>
                <input
                  type="text"
                  value={formDataProxy.port}
                  onChange={(e) => setFormDataProxy({ ...formDataProxy, port: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Protocol *
                </label>
                <input
                  type="text"
                  value={formDataProxy.protocol}
                  onChange={(e) => setFormDataProxy({ ...formDataProxy, protocol: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Usuario *
                </label>
                <input
                  type="text"
                  value={formDataProxy.username}
                  onChange={(e) => setFormDataProxy({ ...formDataProxy, username: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Senha *
                </label>
                <input
                  type="text"
                  value={formDataProxy.password}
                  onChange={(e) => setFormDataProxy({ ...formDataProxy, password: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700"
                  required
                />
              </div>
              

              <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModalProxy(false);
                    setEditingProxy(null);
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm sm:text-base"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7BC84A] flex items-center justify-center gap-2 text-sm sm:text-base"
                >
                  <Save className="w-4 h-4" />
                  {editingProxy ? 'Salvar Alterações' : 'Criar Proxy'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};


const HierarchySection = ({ userId }: { userId: string | null }) => {
  const [hierarchy, setHierarchy] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [crmBancas, setCrmBancas] = useState<any[]>([]);
  const [bancaSearch, setBancaSearch] = useState('');
  const [bancaFilter, setBancaFilter] = useState<'all' | 'sem_dono' | 'com_dono'>('all');
  const [issuesCurrentPage, setIssuesCurrentPage] = useState(1);
  const issuesPerPage = 10;
  const [bancasCurrentPage, setBancasCurrentPage] = useState(1);
  const bancasPerPage = 5;
  const [editingUser, setEditingUser] = useState<any>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createFormData, setCreateFormData] = useState({
    email: '',
    fullName: '',
    password: '',
    status: 'consultor' as 'consultor' | 'gerente' | 'dono_banca',
    enroller: '',
    bancaOwnerId: '',
    bancaName: '',
    bancaUrl: '',
    initialBancaIds: [] as string[],
  });
  const [editFormData, setEditFormData] = useState({
    email: '',
    password: '',
  });
  const [crmTimeData, setCrmTimeData] = useState<Record<string, number>>({});
  const [showFixModal, setShowFixModal] = useState(false);
  const [fixingIssue, setFixingIssue] = useState<any>(null);
  const [selectedFixRole, setSelectedFixRole] = useState<'dono_banca' | 'gerente' | 'consultor'>('gerente');
  const [selectedFixBancaId, setSelectedFixBancaId] = useState<string>('');
  const [selectedEnroller, setSelectedEnroller] = useState<string>(''); // usado para consultor (gerente)
  const [allUsers, setAllUsers] = useState<any[]>([]);

  useEffect(() => {
    if (userId) {
      loadHierarchyData();
    }
  }, [userId]);

  const loadHierarchyData = async () => {
    setLoading(true);
    try {
      const [hierarchyRes, issuesRes, usersRes, bancasRes] = await Promise.all([
        fetch('/api/admin/users/hierarchy', { headers: { 'X-User-Id': userId! } }),
        fetch('/api/admin/users/validate-hierarchy', { headers: { 'X-User-Id': userId! } }),
        fetch('/api/admin/users', { headers: { 'X-User-Id': userId! } }),
        fetch('/api/admin/crm/bancas?with_users=1', { headers: { 'X-User-Id': userId! } }),
      ]);

      if (hierarchyRes.ok) {
        const data = await hierarchyRes.json();
        setHierarchy(data.data || []);
      }
      if (issuesRes.ok) {
        const data = await issuesRes.json();
        setIssues(data.data?.issues || []);
      }
      if (bancasRes.ok) {
        const data = await bancasRes.json();
        setCrmBancas(data.data || []);
      }
      if (usersRes.ok) {
        const data = await usersRes.json();
        setAllUsers(data.data || []);
        const crmTimes: Record<string, number> = {};
        setCrmTimeData(crmTimes);
      }
    } catch (error) {
      console.error('Erro ao carregar hierarquia:', error);
    } finally {
      setLoading(false);
    }
  };

  const normalizeBancaUrl = (url?: string | null) => {
    if (!url) return '';
    let normalized = String(url).trim();
    normalized = normalized.replace(/^https?:\/\//i, '');
    normalized = normalized.replace(/\/api\/crm\/?/i, '');
    normalized = normalized.replace(/\/+$/, '');
    return normalized.trim().toLowerCase();
  };

  const formatTime = (seconds: number = 0) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return '0m';
  };

  const handleEditUser = (user: any) => {
    setEditingUser(user);
    setEditFormData({
      email: user.email || '',
      password: '',
    });
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!editingUser) return;
    
    try {
      const res = await fetch(`/api/admin/users/${editingUser.id}/update`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId!,
        },
        body: JSON.stringify({
          email: editFormData.email || undefined,
          password: editFormData.password || undefined,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        alert('Usuário atualizado com sucesso!');
        setShowEditModal(false);
        setEditingUser(null);
        loadHierarchyData();
      } else {
        alert(data.message || 'Erro ao atualizar usuário');
      }
    } catch (error) {
      console.error('Erro ao atualizar usuário:', error);
      alert('Erro ao atualizar usuário');
    }
  };

  const findOwnerByCrmBanca = (crmBancaId: string) => {
    const banca = (crmBancas || []).find((b: any) => String(b.id) === String(crmBancaId));
    if (!banca) return null;
    const bancaUrlNorm = normalizeBancaUrl(banca.url);
    return (hierarchy || []).find((h: any) => normalizeBancaUrl(h.banca_url) === bancaUrlNorm) || null;
  };

  const getManagersByCrmBanca = (crmBancaId: string) => {
    const owner = findOwnerByCrmBanca(crmBancaId);
    return owner?.subordinates || [];
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const res = await fetch('/api/admin/users/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId!,
        },
        body: JSON.stringify({
          email: createFormData.email,
          fullName: createFormData.fullName,
          password: createFormData.password,
          status: createFormData.status,
          enroller: createFormData.status === 'dono_banca' ? null : (createFormData.enroller || null),
          bancaName: createFormData.status === 'dono_banca' ? createFormData.bancaName : undefined,
          bancaUrl: createFormData.status === 'dono_banca' ? createFormData.bancaUrl : undefined,
          banca_ids: (createFormData.status === 'consultor' || createFormData.status === 'gerente') && createFormData.initialBancaIds?.length ? createFormData.initialBancaIds : undefined,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        alert(
          `${
            createFormData.status === 'dono_banca'
              ? 'Dono de banca'
              : createFormData.status === 'gerente'
              ? 'Gerente'
              : 'Consultor'
          } criado com sucesso!`
        );
        setShowCreateModal(false);
        setCreateFormData({
          email: '',
          fullName: '',
          password: '',
          status: 'consultor',
          enroller: '',
          bancaOwnerId: '',
          bancaName: '',
          bancaUrl: '',
          initialBancaIds: [],
        });
        loadHierarchyData();
      } else {
        alert(data.message || 'Erro ao criar usuário');
      }
    } catch (error) {
      console.error('Erro ao criar usuário:', error);
      alert('Erro ao criar usuário');
    }
  };

  const handleFixIssue = async (issue: any) => {
    // Busca informações do usuário com problema
    try {
      const usersRes = await fetch('/api/admin/users', {
        headers: { 'X-User-Id': userId! },
      });
      
      if (usersRes.ok) {
        const usersData = await usersRes.json();
        const userWithIssue = usersData.data?.find((u: any) => u.email === issue.email);
        
        if (userWithIssue) {
          setFixingIssue({ ...issue, userId: userWithIssue.id, status: userWithIssue.status });

          // Role default
          const defaultRole =
            userWithIssue.status === 'consultor'
              ? 'consultor'
              : userWithIssue.status === 'dono_banca'
              ? 'dono_banca'
              : 'gerente';
          setSelectedFixRole(defaultRole);

          // Banca default (primeira do CRM)
          const firstBancaId = (crmBancas && crmBancas.length > 0) ? String(crmBancas[0].id) : '';
          setSelectedFixBancaId(firstBancaId);

          // Enroller default (para consultor -> primeiro gerente disponível da banca)
          if (defaultRole === 'consultor' && firstBancaId) {
            const managers = getManagersByCrmBanca(firstBancaId);
            if (managers && managers.length > 0) {
              setSelectedEnroller(managers[0].id);
            } else {
              setSelectedEnroller('');
            }
          } else {
            setSelectedEnroller('');
          }
          
          setShowFixModal(true);
        } else {
          alert('Usuário não encontrado');
        }
      }
    } catch (error) {
      console.error('Erro ao buscar informações do usuário:', error);
      alert('Erro ao buscar informações do usuário');
    }
  };

  const handleSaveFix = async () => {
    if (!fixingIssue) return;
    if (!selectedFixBancaId) {
      alert('Selecione uma banca');
      return;
    }

    const selectedBanca = (crmBancas || []).find((b: any) => String(b.id) === String(selectedFixBancaId));
    if (!selectedBanca) {
      alert('Banca inválida');
      return;
    }

    const owner = findOwnerByCrmBanca(selectedFixBancaId);

    if (selectedFixRole === 'gerente' && !owner) {
      alert('Essa banca ainda não tem Dono cadastrado. Crie o Dono primeiro.');
      return;
    }

    if (selectedFixRole === 'consultor') {
      const managers = getManagersByCrmBanca(selectedFixBancaId);
      if (!managers || managers.length === 0) {
        alert('Essa banca ainda não tem Gerentes cadastrados. Crie um Gerente primeiro.');
        return;
      }
      if (!selectedEnroller) {
        alert('Selecione um gerente');
        return;
      }
    }

    try {
      const payload: any = {
        status: selectedFixRole,
      };

      if (selectedFixRole === 'dono_banca') {
        payload.enroller = null;
        payload.bancaName = selectedBanca.name || null;
        payload.bancaUrl = normalizeBancaUrl(selectedBanca.url || '');
      } else if (selectedFixRole === 'gerente') {
        payload.enroller = owner.id;
      } else if (selectedFixRole === 'consultor') {
        payload.enroller = selectedEnroller;
      }

      const res = await fetch(`/api/admin/users/${fixingIssue.userId}/update`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId!,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        alert('Problema corrigido com sucesso!');
        setShowFixModal(false);
        setFixingIssue(null);
        setSelectedFixBancaId('');
        setSelectedFixRole('gerente');
        setSelectedEnroller('');
        loadHierarchyData();
      } else {
        alert(data.message || 'Erro ao corrigir problema');
      }
    } catch (error) {
      console.error('Erro ao corrigir problema:', error);
      alert('Erro ao corrigir problema');
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-100 rounded-xl shadow p-6 border border-gray-200 flex items-center justify-center">
        <RefreshCw className="w-6 h-6 animate-spin text-[#8CD955] mr-3" />
        <span className="text-gray-600">Carregando dados da hierarquia...</span>
      </div>
    );
  }

  const renderUserCard = (user: any, role: 'dono' | 'gerente' | 'consultor', parentBanca?: any) => {
    const roleConfig = {
      dono: { color: 'emerald', bg: 'bg-emerald-500', label: 'Dono de Banca', icon: Building2 },
      gerente: { color: 'blue', bg: 'bg-blue-500', label: 'Gerente', icon: Users },
      consultor: { color: 'green', bg: 'bg-green-500', label: 'Consultor', icon: User },
    };
    const config = roleConfig[role];
    const Icon = config.icon;
    const zaplotoHours = formatTime(user.total_online_time || 0);
    const crmHours = formatTime(crmTimeData[user.id] || 0);

    return (
      <div className={`bg-white rounded-xl shadow-md border border-gray-200 p-4 hover:shadow-lg transition-shadow`}>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3 flex-1">
            <div className={`w-12 h-12 rounded-full ${config.bg} text-white flex items-center justify-center font-bold text-sm flex-shrink-0 shadow-lg`}>
              <Icon className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-gray-900 text-base truncate">{user.full_name || user.email}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-md uppercase font-bold tracking-tighter inline-block mt-1 ${
                role === 'dono' ? 'bg-emerald-100 text-emerald-700' :
                role === 'gerente' ? 'bg-blue-100 text-blue-700' :
                'bg-green-100 text-green-700'
              }`}>
                {config.label}
              </span>
            </div>
          </div>
          <button
            onClick={() => handleEditUser(user)}
            className="p-2 text-gray-400 hover:text-[#8CD955] hover:bg-gray-50 rounded-lg transition-colors"
            title="Editar usuário"
          >
            <EditIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3 border-t border-gray-100 pt-3">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Mail className="w-4 h-4 text-gray-400" />
            <span className="truncate">{user.email}</span>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="flex items-center gap-1 mb-1">
                <Clock className="w-3 h-3 text-gray-500" />
                <span className="text-xs font-medium text-gray-600">Zaploto</span>
              </div>
              <p className="text-sm font-bold text-gray-800">{zaplotoHours}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="flex items-center gap-1 mb-1">
                <TrendingUp className="w-3 h-3 text-gray-500" />
                <span className="text-xs font-medium text-gray-600">CRM</span>
              </div>
              <p className="text-sm font-bold text-gray-800">{crmHours}</p>
            </div>
          </div>

          {role === 'consultor' && (
            <a
              href={`/crm/kanban?userId=${user.id}`}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7BC84A] transition-colors text-sm font-medium"
            >
              <TrendingUp className="w-4 h-4" />
              Acessar CRM
            </a>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Relatório de Integridade */}
      {issues.length > 0 && (
        <div className="bg-gradient-to-br from-white to-amber-50 rounded-xl shadow-lg border border-amber-100 p-4 sm:p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-200/20 rounded-full -mr-16 -mt-16"></div>
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-amber-300/10 rounded-full -ml-12 -mb-12"></div>
          <div className="relative z-10">
            <h2 className="text-lg sm:text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600" />
              Integridade da Estrutura
            </h2>
            <div className="space-y-3">
              {issues
                .slice((issuesCurrentPage - 1) * issuesPerPage, issuesCurrentPage * issuesPerPage)
                .map((issue: any, idx) => (
                <div key={idx} className="p-4 bg-red-50 border border-red-100 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-red-800 text-sm sm:text-base">{issue.email}</p>
                    <p className="text-xs sm:text-sm text-red-600">{issue.issue}</p>
                  </div>
                  <button 
                    onClick={() => handleFixIssue(issue)}
                    className="px-3 py-1.5 bg-white text-red-600 border border-red-200 rounded-lg text-xs font-bold hover:bg-red-50 transition-colors whitespace-nowrap"
                  >
                    Corrigir
                  </button>
                </div>
              ))}
            </div>
            {issues.length > issuesPerPage && (
              <div className="mt-4">
                <Pagination
                  currentPage={issuesCurrentPage}
                  totalPages={Math.ceil(issues.length / issuesPerPage)}
                  onPageChange={setIssuesCurrentPage}
                  itemsPerPage={issuesPerPage}
                  totalItems={issues.length}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cards de Bancas */}
      <div className="space-y-6">
        {/* Barra de busca e filtros */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              value={bancaSearch}
              onChange={(e) => {
                setBancaSearch(e.target.value);
                setBancasCurrentPage(1);
              }}
              placeholder="Pesquisar banca por nome ou URL..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700"
            />
          </div>
          <div className="flex items-center gap-2">
            <select
              value={bancaFilter}
              onChange={(e) => {
                setBancaFilter(e.target.value as any);
                setBancasCurrentPage(1);
              }}
              className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 bg-white"
              title="Filtro de bancas"
            >
              <option value="all">Todas</option>
              <option value="sem_dono">Sem dono</option>
              <option value="com_dono">Com dono</option>
            </select>
            <button
              onClick={loadHierarchyData}
              className="px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2"
              title="Recarregar"
            >
              <RefreshCw className="w-4 h-4" />
              <span className="hidden sm:inline">Recarregar</span>
            </button>
          </div>
        </div>

        {crmBancas && crmBancas.length > 0 ? (() => {
          const filteredBancas = crmBancas.filter((b: any) => {
            const search = bancaSearch.trim().toLowerCase();
            if (!search) return true;
            const name = String(b.name || '').toLowerCase();
            const url = String(b.url || '').toLowerCase();
            return name.includes(search) || url.includes(search);
          });

          const pagedBancas = filteredBancas.slice(
            (bancasCurrentPage - 1) * bancasPerPage,
            bancasCurrentPage * bancasPerPage
          );

          return (
            <>
              {pagedBancas.map((crmBanca: any) => {
              const bancaUrlNorm = normalizeBancaUrl(crmBanca.url);
              const owner = (hierarchy || []).find((h: any) => normalizeBancaUrl(h.banca_url) === bancaUrlNorm);

              if (bancaFilter === 'sem_dono' && owner) return null;
              if (bancaFilter === 'com_dono' && !owner) return null;

              return (
                <div
                  key={crmBanca.id}
                  className="bg-gradient-to-br from-white to-emerald-50 rounded-xl shadow-lg border border-emerald-100 p-6 relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-40 h-40 bg-emerald-200/20 rounded-full -mr-20 -mt-20"></div>
                  <div className="absolute bottom-0 left-0 w-32 h-32 bg-emerald-300/10 rounded-full -ml-16 -mb-16"></div>

                  <div className="relative z-10">
                    {/* Cabeçalho da Banca */}
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6 pb-4 border-b border-emerald-100">
                      <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-full bg-[#8CD955] text-white flex items-center justify-center font-bold text-xl flex-shrink-0 shadow-lg shadow-emerald-100">
                          {crmBanca.name ? String(crmBanca.name).substring(0, 2).toUpperCase() : 'BK'}
                        </div>
                        <div>
                          <h2 className="text-2xl font-bold text-gray-900 mb-1">{crmBanca.name || 'Banca sem nome'}</h2>
                          {crmBanca.url && (
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                              <a
                                href={`https://${normalizeBancaUrl(crmBanca.url)}`}
                                target="_blank"
                                className="text-sm text-[#8CD955] hover:underline font-medium flex items-center gap-1"
                              >
                                <Globe className="w-4 h-4" />
                                {normalizeBancaUrl(crmBanca.url)}
                              </a>
                              {!owner && (
                                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-md font-bold">
                                  Sem dono cadastrado
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {!owner && (
                          <>
                            <button
                              onClick={() => {
                                setCreateFormData(prev => ({
                                  ...prev,
                                  status: 'dono_banca',
                                  enroller: '',
                                  bancaOwnerId: '',
                                  bancaName: crmBanca.name || '',
                                  bancaUrl: normalizeBancaUrl(crmBanca.url || ''),
                                  initialBancaIds: [],
                                }));
                                setShowCreateModal(true);
                              }}
                              className="flex items-center gap-2 px-4 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7BC84A] transition-colors font-medium"
                            >
                              <UserPlus className="w-4 h-4" />
                              Criar Dono
                            </button>
                            <button
                              onClick={() => {
                                setCreateFormData(prev => ({
                                  ...prev,
                                  status: 'gerente',
                                  enroller: '',
                                  bancaOwnerId: '',
                                  bancaName: '',
                                  bancaUrl: '',
                                  initialBancaIds: [String(crmBanca.id)],
                                }));
                                setShowCreateModal(true);
                              }}
                              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                            >
                              <UserPlus className="w-4 h-4" />
                              Adicionar Gerente
                            </button>
                            <button
                              onClick={() => {
                                setCreateFormData(prev => ({
                                  ...prev,
                                  status: 'consultor',
                                  enroller: '',
                                  bancaOwnerId: '',
                                  bancaName: '',
                                  bancaUrl: '',
                                  initialBancaIds: [String(crmBanca.id)],
                                }));
                                setShowCreateModal(true);
                              }}
                              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium"
                            >
                              <UserPlus className="w-4 h-4" />
                              Adicionar Consultor
                            </button>
                          </>
                        )}

                        {owner && (
                          <button
                            onClick={() => {
                              setCreateFormData(prev => ({
                                ...prev,
                                status: 'gerente',
                                enroller: owner.id,
                                bancaOwnerId: owner.id,
                                bancaName: owner.banca_name || crmBanca.name || '',
                                bancaUrl: normalizeBancaUrl(owner.banca_url || crmBanca.url || ''),
                                initialBancaIds: [String(crmBanca.id)],
                              }));
                              setShowCreateModal(true);
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                          >
                            <UserPlus className="w-4 h-4" />
                            Adicionar Gerente
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Dono da Banca */}
                    <div className="mb-6">
                      <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                        <Building2 className="w-5 h-5 text-emerald-600" />
                        Dono da Banca
                      </h3>
                      {owner ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {renderUserCard(owner, 'dono')}
                        </div>
                      ) : (
                        <div className="bg-white rounded-xl border border-gray-200 p-6 text-gray-600">
                          <p className="font-medium">Nenhum dono cadastrado para esta banca.</p>
                          <p className="text-sm text-gray-500 mt-1">Crie um Dono de Banca ou atribua Gerentes/Consultores diretamente a esta banca.</p>
                        </div>
                      )}
                    </div>

                    {/* Gerentes e Consultores atribuídos à banca (sem dono) - via user_bancas */}
                    {!owner && (
                      <div className="mb-6">
                        <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                          <Users className="w-5 h-5 text-blue-600" />
                          Gerentes e Consultores nesta banca
                          {crmBanca.user_ids?.length > 0 && ` (${crmBanca.user_ids.length})`}
                        </h3>
                        {crmBanca.user_ids?.length > 0 ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {(crmBanca.user_ids || []).map((uid: string) => {
                              const u = allUsers.find((x: any) => x.id === uid);
                              if (!u) return null;
                              return (
                                <div key={uid} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="font-medium text-gray-900 truncate">{u.full_name || u.email}</p>
                                    <p className="text-xs text-gray-500 truncate">{u.email}</p>
                                    <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-bold ${
                                      u.status === 'gerente' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                                    }`}>
                                      {u.status === 'gerente' ? 'Gerente' : 'Consultor'}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleEditUser(u)}
                                    className="p-1.5 text-gray-500 hover:bg-gray-100 rounded"
                                    title="Editar"
                                  >
                                    <EditIcon className="w-4 h-4" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500">Nenhum gerente ou consultor atribuído. Use os botões acima para criar ou adicionar.</p>
                        )}
                      </div>
                    )}

                    {/* Gerentes / Consultores (apenas se houver dono) */}
                    {owner && owner.subordinates && owner.subordinates.length > 0 && (
                      <div className="mb-6">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                            <Users className="w-5 h-5 text-blue-600" />
                            Gerentes ({owner.subordinates.length})
                          </h3>
                        </div>
                        <div className="space-y-6">
                          {owner.subordinates.map((gerente: any) => (
                            <div key={gerente.id} className="bg-blue-50/30 rounded-lg p-4 border border-blue-100">
                              {renderUserCard(gerente, 'gerente', owner)}
                              {gerente.subordinates && gerente.subordinates.length > 0 ? (
                                <div className="mt-4 pl-4 border-l-2 border-blue-300 space-y-3">
                                  <div className="flex items-center justify-between mb-3">
                                    <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
                                      <User className="w-4 h-4 text-green-600" />
                                      Consultores ({gerente.subordinates.length})
                                    </h4>
                                    <button
                                      onClick={() => {
                                        setCreateFormData(prev => ({
                                          ...prev,
                                          status: 'consultor',
                                          enroller: gerente.id,
                                          bancaOwnerId: owner.id,
                                          bancaName: owner.banca_name || crmBanca.name || '',
                                          bancaUrl: normalizeBancaUrl(owner.banca_url || crmBanca.url || ''),
                                          initialBancaIds: [String(crmBanca.id)],
                                        }));
                                        setShowCreateModal(true);
                                      }}
                                      className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                                      title="Adicionar Consultor"
                                    >
                                      <UserPlus className="w-4 h-4" />
                                    </button>
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {gerente.subordinates.map((consultor: any) => (
                                      <div key={consultor.id}>
                                        {renderUserCard(consultor, 'consultor', owner)}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <div className="mt-4 pl-4 border-l-2 border-blue-300">
                                    <button
                                      onClick={() => {
                                        setCreateFormData(prev => ({
                                          ...prev,
                                          status: 'consultor',
                                          enroller: gerente.id,
                                          bancaOwnerId: owner.id,
                                          bancaName: owner.banca_name || crmBanca.name || '',
                                          bancaUrl: normalizeBancaUrl(owner.banca_url || crmBanca.url || ''),
                                          initialBancaIds: [String(crmBanca.id)],
                                        }));
                                        setShowCreateModal(true);
                                      }}
                                      className="w-full p-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-green-400 hover:text-green-600 transition-colors text-sm font-medium flex items-center justify-center gap-2"
                                    >
                                      <UserPlus className="w-4 h-4" />
                                      Adicionar Consultor
                                    </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {owner && (!owner.subordinates || owner.subordinates.length === 0) && (
                      <div className="text-center py-8 text-gray-500">
                        <Users className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                        <p className="font-medium">Nenhum gerente cadastrado</p>
                        <button
                          onClick={() => {
                            setCreateFormData(prev => ({
                              ...prev,
                              status: 'gerente',
                              enroller: owner.id,
                              bancaOwnerId: owner.id,
                              bancaName: owner.banca_name || crmBanca.name || '',
                              bancaUrl: normalizeBancaUrl(owner.banca_url || crmBanca.url || ''),
                              initialBancaIds: [String(crmBanca.id)],
                            }));
                            setShowCreateModal(true);
                          }}
                          className="mt-3 text-sm text-[#8CD955] hover:underline"
                        >
                          Adicionar primeiro gerente
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

              {filteredBancas.length > bancasPerPage && (
                <Pagination
                  currentPage={bancasCurrentPage}
                  totalPages={Math.ceil(filteredBancas.length / bancasPerPage)}
                  onPageChange={setBancasCurrentPage}
                  itemsPerPage={bancasPerPage}
                  totalItems={filteredBancas.length}
                />
              )}
            </>
          );
        })() : (
          <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-12 text-center">
            <Building2 className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-xl font-bold text-gray-800 mb-2">Nenhuma banca cadastrada no CRM</h3>
            <p className="text-gray-600">Cadastre bancas em `crm_bancas` para que elas apareçam aqui.</p>
          </div>
        )}
      </div>

      {/* Modal de Edição */}
      {showEditModal && editingUser && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-[#8CD955] to-[#7BC84A] text-white">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <EditIcon className="w-6 h-6" />
                Editar Usuário
              </h2>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditingUser(null);
                }}
                className="hover:bg-white/20 p-1.5 rounded-lg transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveEdit();
              }}
              className="p-6 space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={editFormData.email}
                  onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nova Senha (deixe em branco para não alterar)
                </label>
                <input
                  type="password"
                  value={editFormData.password}
                  onChange={(e) => setEditFormData({ ...editFormData, password: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700"
                  placeholder="••••••••"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false);
                    setEditingUser(null);
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7BC84A] transition-colors font-medium"
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Criação */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-blue-600 to-blue-500 text-white">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <UserPlus className="w-6 h-6" />
                Criar {createFormData.status === 'dono_banca' ? 'Dono de Banca' : createFormData.status === 'gerente' ? 'Gerente' : 'Consultor'}
              </h2>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setCreateFormData({
                    email: '',
                    fullName: '',
                    password: '',
                    status: 'consultor',
                    enroller: '',
                    bancaOwnerId: '',
                    bancaName: '',
                    bancaUrl: '',
                    initialBancaIds: [],
                  });
                }}
                className="hover:bg-white/20 p-1.5 rounded-lg transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nome Completo
                </label>
                <input
                  type="text"
                  value={createFormData.fullName}
                  onChange={(e) => setCreateFormData({ ...createFormData, fullName: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700"
                  placeholder="Nome do usuário"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email *
                </label>
                <input
                  type="email"
                  value={createFormData.email}
                  onChange={(e) => setCreateFormData({ ...createFormData, email: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Senha *
                </label>
                <input
                  type="password"
                  value={createFormData.password}
                  onChange={(e) => setCreateFormData({ ...createFormData, password: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700"
                  required
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setCreateFormData({
                      email: '',
                      fullName: '',
                      password: '',
                      status: 'consultor',
                      enroller: '',
                      bancaOwnerId: '',
                      bancaName: '',
                      bancaUrl: '',
                      initialBancaIds: [],
                    });
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  Criar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Correção de Problema */}
      {showFixModal && fixingIssue && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-amber-600 to-amber-500 text-white">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <AlertCircle className="w-6 h-6" />
                Corrigir Problema
              </h2>
              <button
                onClick={() => {
                  setShowFixModal(false);
                  setFixingIssue(null);
                  setSelectedEnroller('');
                }}
                className="hover:bg-white/20 p-1.5 rounded-lg transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm font-medium text-red-800 mb-1">Usuário:</p>
                <p className="text-sm text-red-700">{fixingIssue.email}</p>
                <p className="text-sm font-medium text-red-800 mt-2 mb-1">Problema:</p>
                <p className="text-sm text-red-700">{fixingIssue.issue}</p>
                {fixingIssue.status && (
                  <>
                    <p className="text-sm font-medium text-red-800 mt-2 mb-1">Status:</p>
                    <p className="text-sm text-red-700 capitalize">{fixingIssue.status}</p>
                  </>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Banca (CRM)</label>
                  <select
                    value={selectedFixBancaId}
                    onChange={(e) => {
                      setSelectedFixBancaId(e.target.value);
                      setSelectedEnroller('');
                    }}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-gray-700"
                  >
                    <option value="">Selecione...</option>
                    {(crmBancas || []).map((b: any) => (
                      <option key={b.id} value={String(b.id)}>
                        {b.name} ({normalizeBancaUrl(b.url)})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">A banca vem da tabela `crm_bancas`.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Cargo</label>
                  <select
                    value={selectedFixRole}
                    onChange={(e) => {
                      const role = e.target.value as any;
                      setSelectedFixRole(role);
                      setSelectedEnroller('');
                    }}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-gray-700"
                  >
                    <option value="dono_banca">Dono de banca</option>
                    <option value="gerente">Gerente</option>
                    <option value="consultor">Consultor</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {selectedFixRole === 'gerente'
                    ? 'Dono da banca (automático)'
                    : selectedFixRole === 'consultor'
                    ? 'Selecione o Gerente'
                    : 'Enroller (não aplicável)'}
                </label>
                {selectedFixRole === 'consultor' ? (
                  <select
                    value={selectedEnroller}
                    onChange={(e) => setSelectedEnroller(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-gray-700"
                  >
                    <option value="">Selecione...</option>
                    {selectedFixBancaId &&
                      getManagersByCrmBanca(selectedFixBancaId).map((m: any) => (
                        <option key={m.id} value={m.id}>
                          {m.full_name || m.email}
                        </option>
                      ))}
                  </select>
                ) : (
                  <div className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-600 text-sm">
                    {selectedFixRole === 'gerente'
                      ? selectedFixBancaId
                        ? (() => {
                            const o = findOwnerByCrmBanca(selectedFixBancaId);
                            return o ? `Dono: ${o.banca_name || o.email}` : 'Esta banca ainda não tem Dono cadastrado';
                          })()
                        : 'Selecione uma banca acima'
                      : 'Para Dono de banca não há enroller'}
                  </div>
                )}

                {selectedFixRole === 'consultor' && (
                  <p className="text-xs text-gray-500 mt-1">Selecione um gerente dessa banca para vincular o consultor.</p>
                )}
                {selectedFixRole === 'gerente' && (
                  <p className="text-xs text-gray-500 mt-1">Gerente é vinculado automaticamente ao Dono da banca selecionada.</p>
                )}
                {selectedFixRole === 'dono_banca' && (
                  <p className="text-xs text-gray-500 mt-1">Ao salvar, o usuário vira Dono e recebe `banca_name/banca_url` da banca selecionada.</p>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowFixModal(false);
                    setFixingIssue(null);
                    setSelectedEnroller('');
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveFix}
                  disabled={!selectedFixBancaId || (selectedFixRole === 'consultor' && !selectedEnroller)}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Corrigir
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
