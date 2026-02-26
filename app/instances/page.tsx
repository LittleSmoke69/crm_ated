'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Layout from '@/components/Layout';
import QRCodeModal from '@/components/QRCodeModal';
import Pagination from '@/components/Admin/Pagination';
import { useDashboardData, WhatsAppInstance } from '@/hooks/useDashboardData';
import {
  Copy,
  Trash2,
  RefreshCw,
  Link as LinkIcon,
  X,
  ChevronLeft,
  ChevronRight,
  Search,
  CheckCircle2,
  AlertCircle,
  Info,
  Menu,
  Star,
  Lock,
  Plus,
  MessageSquare,
  Zap,
  Phone,
  Loader2,
} from 'lucide-react';
import { useSidebar } from '@/contexts/SidebarContext';
import { supabase } from '@/lib/supabase';

const QR_WINDOW_SECONDS = 30;
const STATUS_FETCH_TIMEOUT_MS = 20000; // 20s - evita travamento se o backend/Evolution estiver lento

/** Fetch para status da instância com timeout (maior estabilidade da conexão). */
async function fetchStatusWithTimeout(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), STATUS_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error('Verificação de status demorou muito. Tente novamente.');
    }
    throw e;
  }
}

const InstancesPage = () => {
  const { checking } = useRequireAuth();
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();
  const {
    userId,
    instances,
    setInstances,
    showToast,
    addLog,
    toasts,
    setToasts,
    loadInitialData,
  } = useDashboardData();

  const [instanceName, setInstanceName] = useState('');
  const [isMaster, setIsMaster] = useState(false);
  const [maturationType, setMaturationType] = useState<'virgem' | 'maturado'>('maturado');
  const [qrCode, setQrCode] = useState('');
  const [qrTimer, setQrTimer] = useState(0);
  const [qrExpired, setQrExpired] = useState(false);
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentConnectingInstance, setCurrentConnectingInstance] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false); // Flag para diferenciar reconexão de criação
  const [isAdmin, setIsAdmin] = useState(false);
  const [isConsultor, setIsConsultor] = useState(false);
  const [checkingInstance, setCheckingInstance] = useState<string | null>(null); // Instância sendo verificada
  const [showExtractGroupsPrompt, setShowExtractGroupsPrompt] = useState(false);
  const [newlyConnectedInstance, setNewlyConnectedInstance] = useState<string | null>(null);
  /** Instância cujo extração de grupos está rodando em segundo plano (null = nenhuma). */
  const [groupsProcessingForInstance, setGroupsProcessingForInstance] = useState<string | null>(null);
  /** Verificação de todas as instâncias em andamento. */
  const [verifyingAll, setVerifyingAll] = useState(false);
  /** Modal de resumo (nome, telefone, status, grupos) aberto. */
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [summaryData, setSummaryData] = useState<Array<{ instance_name: string; phone: string | null; status: string; groups_count: number }>>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Estados para modal de telefone
  const [isPhoneModalOpen, setIsPhoneModalOpen] = useState(false);
  const [phoneValue, setPhoneValue] = useState('');
  const [selectedInstanceForPhone, setSelectedInstanceForPhone] = useState<WhatsAppInstance | null>(null);
  const [isSavingPhone, setIsSavingPhone] = useState(false);
  
  // Função helper para verificar se o modal de extrair grupos já foi mostrado para uma instância
  const hasShownExtractGroupsModal = (instanceName: string): boolean => {
    if (typeof window === 'undefined') return false;
    const key = `extract_groups_modal_shown_${instanceName}`;
    return localStorage.getItem(key) === 'true';
  };

  // Função helper para marcar que o modal de extrair grupos foi mostrado para uma instância
  const markExtractGroupsModalAsShown = (instanceName: string): void => {
    if (typeof window === 'undefined') return;
    const key = `extract_groups_modal_shown_${instanceName}`;
    localStorage.setItem(key, 'true');
  };

  // Função helper para mostrar o modal de extrair grupos (só se for nova instância e ainda não foi mostrado)
  const showExtractGroupsModalIfNeeded = (instanceName: string, isNewInstance: boolean): void => {
    // Só mostra para novas instâncias (não reconexões)
    if (!isNewInstance) {
      return;
    }

    // Verifica se já foi mostrado para esta instância
    if (hasShownExtractGroupsModal(instanceName)) {
      return;
    }

    // Marca como mostrado e exibe o modal
    markExtractGroupsModalAsShown(instanceName);
    setNewlyConnectedInstance(instanceName);
    setShowExtractGroupsPrompt(true);
  };
  
  // Paginação e filtro de instâncias
  const [instanceFilter, setInstanceFilter] = useState<'todas' | 'connected' | 'disconnected'>('todas');
  const [instanceCurrentPage, setInstanceCurrentPage] = useState(1);
  const [instanceItemsPerPage] = useState(6);
  const [isLoadingInstances, setIsLoadingInstances] = useState(true);

  // Carrega dados iniciais quando o componente monta
  useEffect(() => {
    if (userId) {
      setIsLoadingInstances(true);
      loadInitialData().finally(() => {
        setIsLoadingInstances(false);
      });
    }
  }, [userId]);
  
  // Atualiza loading quando instâncias mudam
  useEffect(() => {
    if (instances.length > 0 && isLoadingInstances) {
      setIsLoadingInstances(false);
    }
  }, [instances.length, isLoadingInstances]);

  useEffect(() => {
    const checkRole = async () => {
      if (!userId) return;
      const { data } = await supabase
        .from('profiles')
        .select('status')
        .eq('id', userId)
        .single();
      setIsAdmin(data?.status === 'admin');
      setIsConsultor(data?.status === 'consultor');
    };
    checkRole();
  }, [userId]);

  const handleCreateInstance = async () => {
    if (!userId) { showToast('Sessão inválida', 'error'); return; }
    if (!instanceName) { showToast('Digite um nome para a instância', 'error'); return; }
    
    // Validação: não permite "/" e espaços no nome
    if (instanceName.includes('/') || instanceName.includes(' ')) {
      showToast('O nome da instância não pode conter espaços ou barras (/)', 'error');
      return;
    }

    // Verifica limite de instâncias antes de criar (admins não têm limite)
    if (!isAdmin) {
      try {
        const limitResponse = await fetch('/api/instances', {
          method: 'GET',
          headers: { 'X-User-Id': userId },
        });
        const limitData = await limitResponse.json();
        
        // Verifica se há informação de limite na resposta
        // A propriedade __limit é não enumerável, então acessamos diretamente
        const limitInfo = (limitData.data as any)?.__limit || limitData.data?.limit;
        if (limitInfo) {
          const { current, max, allowed } = limitInfo;
          if (!allowed) {
            showToast(`Limite de instâncias atingido! Você possui ${current} de ${max} instâncias permitidas.`, 'error');
            addLog(`Limite de instâncias atingido: ${current}/${max}`, 'error');
            return;
          }
        } else {
          // Fallback: verifica usando o número de instâncias carregadas
          // Se não conseguir obter o limite, usa o padrão de 20
          if (instances.length >= 20) {
            showToast(`Limite de instâncias atingido! Você possui ${instances.length} instâncias.`, 'error');
            addLog(`Limite de instâncias atingido: ${instances.length}`, 'error');
            return;
          }
        }
      } catch (limitError) {
        // Se falhar ao verificar limite, continua (a API também verifica)
        console.warn('Erro ao verificar limite de instâncias:', limitError);
      }
    }

    setLoading(true);
    try {
      addLog(`Criando instância ${instanceName}...`, 'info');

      const response = await fetch('/api/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ instanceName, isMaster, maturationType }),
      });

      const data = await response.json().catch((err) => {
        console.error('Erro ao parsear resposta:', err);
        return { success: false, error: 'Erro ao processar resposta do servidor' };
      });

      console.log('Resposta da API:', { response: { ok: response.ok, status: response.status }, data });

      if (response.ok && data.success && data.data) {
        const instanceData = data.data;
        // Tenta diferentes formatos de QR code
        const qrCodeValue = instanceData.qr_code || 
                          instanceData.qrcode?.base64 || 
                          instanceData.qrcode || 
                          '';
        
        console.log('QR Code recebido:', { 
          hasQrCode: !!qrCodeValue, 
          qrCodeLength: qrCodeValue?.length || 0,
          instanceDataKeys: Object.keys(instanceData)
        });
        
        if (qrCodeValue && qrCodeValue.trim().length > 0) {
          // Limpa o QR code removendo espaços e quebras de linha
          const cleanQrCode = qrCodeValue.trim().replace(/\s/g, '');
          
          // Valida se parece ser base64 válido
          if (/^[A-Za-z0-9+/=]+$/.test(cleanQrCode) && cleanQrCode.length >= 100) {
            showToast('Instância criada com sucesso!', 'success');
            addLog(`Instância ${instanceName} criada com QR Code válido`, 'success');
            
            // Define o QR code e configura o estado ANTES de abrir o modal
            setQrExpired(false);
            setQrCode(cleanQrCode);
            setCurrentConnectingInstance(instanceName); // Marca qual instância está conectando
            setIsReconnecting(false); // É criação, não reconexão
            setQrTimer(QR_WINDOW_SECONDS); // Define o timer primeiro
            // Abre o modal - o useEffect detectará a abertura e iniciará o timer
            setIsQRModalOpen(true);
            
            // Limpa os campos e fecha o modal
            setInstanceName('');
            setIsMaster(false);
            setMaturationType('maturado');
            setIsCreateModalOpen(false);
            
            // NÃO recarrega os dados imediatamente após criar a instância
            // O recarregamento será feito apenas quando:
            // 1. O usuário verificar o status manualmente
            // 2. O QR code expirar e precisar gerar novo
            // 3. A instância realmente conectar (detectado pelo useEffect)
            // Isso evita verificação prematura que pode marcar como conectada sem escanear
          } else {
            console.warn('QR Code recebido não parece ser válido:', {
              length: cleanQrCode.length,
              startsWith: cleanQrCode.substring(0, 20),
            });
            showToast('Instância criada, mas QR Code inválido. Verifique o status da instância.', 'info');
            addLog(`Instância ${instanceName} criada com QR Code inválido. Verifique o status.`, 'info');
            // Ainda tenta exibir, mas pode falhar
            setQrExpired(false);
            setQrCode(cleanQrCode);
            setCurrentConnectingInstance(instanceName); // Marca qual instância está conectando
            setIsReconnecting(false); // É criação, não reconexão
            setQrTimer(QR_WINDOW_SECONDS); // Define o timer primeiro
            setIsQRModalOpen(true); // Abre o modal mesmo com QR inválido
            
            setInstanceName('');
            setMaturationType('maturado');
            setIsCreateModalOpen(false);
            // NÃO recarrega automaticamente - evita verificação prematura de status
          }
        } else {
          showToast('Instância criada, mas QR Code não foi retornado. Verifique o status da instância.', 'info');
          addLog(`Instância ${instanceName} criada sem QR Code. Verifique o status.`, 'info');
          setInstanceName('');
          setMaturationType('maturado');
          setIsCreateModalOpen(false);
          await loadInitialData();
        }
      } else {
        const errorMsg = data.error || data.message || 'Erro ao criar instância';
        
        // Verifica se é erro de limite atingido
        if (response.status === 429 || errorMsg.includes('Limite de instâncias')) {
          showToast(errorMsg, 'error');
          addLog(`Limite de instâncias atingido: ${errorMsg}`, 'error');
        } else {
          showToast(errorMsg, 'error');
          addLog(`Erro ao criar instância: ${errorMsg}`, 'error');
        }
        console.error('Erro na criação:', { response, data });
      }
    } catch (error) {
      showToast('Erro ao criar instância', 'error');
      addLog(`Erro: ${String(error)}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleExtractAllGroups = async (instanceName: string) => {
    if (!userId) return;

    try {
      showToast('Extraindo grupos...', 'info');
      addLog(`Extraindo todos os grupos da instância ${instanceName}...`, 'info');

      const fetchResponse = await fetch('/api/groups/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ instanceName }),
      });

      const fetchData = await fetchResponse.json();
      if (!fetchResponse.ok || !fetchData.data) {
        showToast('Erro ao buscar grupos da API', 'error');
        return;
      }

      const groups = fetchData.data;

      const syncResponse = await fetch('/api/groups/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ instanceName, groups }),
      });

      const syncData = await syncResponse.json();
      if (syncResponse.ok && syncData.success) {
        const { inserted = 0, updated = 0 } = syncData.data || {};
        showToast(`${inserted + updated} grupo(s) sincronizado(s) com sucesso!`, 'success');
        addLog(`${inserted + updated} grupos sincronizados da instância ${instanceName} (sem duplicatas)`, 'success');
      } else {
        showToast(syncData.error || 'Erro ao sincronizar grupos', 'error');
      }
    } catch (error) {
      showToast('Erro ao extrair grupos', 'error');
      addLog(`Erro ao extrair grupos: ${String(error)}`, 'error');
    }
  };

  /** Roda extração de grupos em segundo plano: mostra banner na tela e avisa quando terminar. */
  const runExtractGroupsInBackground = useCallback(
    (instanceName: string) => {
      if (!userId) return;
      setGroupsProcessingForInstance(instanceName);
      addLog(`Grupos da instância ${instanceName} sendo processados em segundo plano...`, 'info');

      (async () => {
        try {
          const fetchResponse = await fetch('/api/groups/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
            body: JSON.stringify({ instanceName }),
          });
          const fetchData = await fetchResponse.json();
          if (!fetchResponse.ok || !fetchData.data) {
            setGroupsProcessingForInstance(null);
            showToast('Erro ao buscar grupos da API', 'error');
            addLog(`Erro ao buscar grupos da instância ${instanceName}`, 'error');
            return;
          }
          const groups = fetchData.data;

          const syncResponse = await fetch('/api/groups/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
            body: JSON.stringify({ instanceName, groups }),
          });
          const syncData = await syncResponse.json();
          setGroupsProcessingForInstance(null);
          if (syncResponse.ok && syncData.success) {
            const { inserted = 0, updated = 0 } = syncData.data || {};
            showToast(`${inserted + updated} grupo(s) sincronizado(s)! Processamento em segundo plano concluído.`, 'success');
            addLog(`${inserted + updated} grupos sincronizados da instância ${instanceName} (em segundo plano)`, 'success');
          } else {
            showToast(syncData.error || 'Erro ao sincronizar grupos', 'error');
          }
        } catch (error) {
          setGroupsProcessingForInstance(null);
          showToast('Erro ao extrair grupos em segundo plano', 'error');
          addLog(`Erro ao extrair grupos (${instanceName}): ${String(error)}`, 'error');
        }
      })();
    },
    [userId, showToast, addLog]
  );

  const handleCheckStatus = async (inst: WhatsAppInstance) => {
    if (!userId || !inst.instance_name) return;
    setCheckingInstance(inst.instance_name);
    try {
      // Faz GET para verificar status real na Evolution API (com timeout para estabilidade)
      const response = await fetchStatusWithTimeout(`/api/instances/${inst.instance_name}/status`, {
        method: 'GET',
        headers: { 'X-User-Id': userId },
      });
      const data = await response.json();
      
      if (data.success && data.data) {
        const statusFromEvolution = data.data.status; // Status real da Evolution API
        
        // Recarrega os dados do banco (que foram atualizados pela API)
        await loadInitialData();
        
        // Verifica se estava desconectada e agora conectou
        const wasDisconnected = inst.status === 'disconnected' || inst.status === 'connecting';
        const nowConnected = statusFromEvolution === 'connected';
        
        // Se conectou, fecha o modal se estiver aberto
        if (nowConnected) {
          setIsQRModalOpen(false);
          setQrCode('');
          setQrTimer(0);
          setQrExpired(false);
          setCurrentConnectingInstance(null);
          setIsReconnecting(false);
          
          // Verifica se é nova instância conectada (não reconexão) e mostra modal apenas uma vez
          // handleCheckStatus é verificação manual, então não é nova instância
          showToast('Instância conectada!', 'success');
        } else if (data.data.qrCode) {
          // Se tem QR code, abre o modal
          setQrExpired(false);
          setQrCode(data.data.qrCode);
          setCurrentConnectingInstance(inst.instance_name);
          setIsReconnecting(false); // Verificação manual não é reconexão
          setQrTimer(QR_WINDOW_SECONDS); // Define o timer primeiro
          setIsQRModalOpen(true); // Abre o modal - o useEffect iniciará o timer
          showToast('QR Code disponível. Escaneie para conectar.', 'info');
        } else {
          // Status atualizado mas não conectou
          showToast('Status verificado e atualizado', 'success');
        }
      } else {
        showToast(data.error || 'Erro ao verificar status', 'error');
      }
    } catch (error) {
      console.error('Erro ao verificar status:', error);
      showToast(error instanceof Error ? error.message : 'Erro ao verificar status', 'error');
    } finally {
      setCheckingInstance(null);
    }
  };

  const handleReconnect = async (inst: WhatsAppInstance) => {
    if (!userId || !inst.instance_name) return;
    setLoading(true);
    try {
      addLog(`Reconectando instância ${inst.instance_name}...`, 'info');
      const response = await fetchStatusWithTimeout(`/api/instances/${inst.instance_name}/status`, {
        method: 'POST',
        headers: { 'X-User-Id': userId },
      });
      const data = await response.json();
      
      if (data.success && data.data) {
        if (data.data.status === 'connected') {
          // Se já está conectada, apenas atualiza
          setIsQRModalOpen(false);
          setQrCode('');
          setQrTimer(0);
          setQrExpired(false);
          setCurrentConnectingInstance(null);
          showToast('Instância já está conectada!', 'success');
          await loadInitialData();
        } else if (data.data.qrCode) {
          // Se tem QR code, abre o modal para reconexão
          // O base64 já vem como data URL completo, não precisa processar
          const qrCodeValue = data.data.qrCode;
          setQrExpired(false);
          setQrCode(qrCodeValue);
          setCurrentConnectingInstance(inst.instance_name);
          setIsReconnecting(true); // Marca como reconexão
          setQrTimer(QR_WINDOW_SECONDS);
          setIsQRModalOpen(true);
          showToast('QR Code de reconexão gerado! Escaneie o código para reconectar.', 'success');
          addLog(`QR Code de reconexão gerado para ${inst.instance_name}`, 'success');
        } else {
          showToast('Reconexão solicitada, mas QR Code não disponível. Verifique o status.', 'info');
          await loadInitialData();
        }
      } else {
        showToast(data.error || 'Erro ao reconectar instância', 'error');
        addLog(`Erro ao reconectar: ${data.error || 'Erro desconhecido'}`, 'error');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Erro ao reconectar instância', 'error');
      addLog(`Erro: ${String(error)}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteInstance = async (inst: WhatsAppInstance) => {
    if (!userId || !inst.instance_name) return;
    if (!confirm(`Tem certeza que deseja deletar a instância ${inst.instance_name}?`)) return;

    try {
      const response = await fetch(`/api/instances/${inst.instance_name}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId },
      });
      const data = await response.json();
      if (response.ok) {
        showToast('Instância deletada', 'success');
        await loadInitialData();
      } else {
        showToast(data.error || 'Erro ao deletar', 'error');
      }
    } catch (error) {
      showToast('Erro ao deletar instância', 'error');
    }
  };

  const handleOpenPhoneModal = (inst: WhatsAppInstance) => {
    setSelectedInstanceForPhone(inst);
    setPhoneValue(inst.number || '');
    setIsPhoneModalOpen(true);
  };

  const handleSavePhone = async () => {
    if (!userId || !selectedInstanceForPhone?.instance_name) return;
    
    setIsSavingPhone(true);
    try {
      const response = await fetch(`/api/instances/${selectedInstanceForPhone.instance_name}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'X-User-Id': userId 
        },
        body: JSON.stringify({ phone_number: phoneValue }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        showToast('Telefone atualizado com sucesso!', 'success');
        setIsPhoneModalOpen(false);
        await loadInitialData();
      } else {
        showToast(data.error || 'Erro ao atualizar telefone', 'error');
      }
    } catch (error) {
      console.error('Erro ao salvar telefone:', error);
      showToast('Erro ao salvar telefone', 'error');
    } finally {
      setIsSavingPhone(false);
    }
  };

  const handleVerifyAllInstances = async () => {
    if (!userId) return;
    setVerifyingAll(true);
    try {
      const response = await fetch('/api/instances/verify-all', {
        method: 'POST',
        headers: { 'X-User-Id': userId },
      });
      const data = await response.json();
      if (response.ok && data.success !== false) {
        const msg = data.data?.message || 'Verificação concluída.';
        showToast(msg, data.data?.processing ? 'info' : 'success');
        if (data.data?.reportSent) {
          addLog('Relatório de instâncias enviado ao seu WhatsApp (Loto Assistente).', 'success');
        }
        await loadInitialData();
      } else {
        showToast(data.error || 'Erro ao verificar instâncias', 'error');
      }
    } catch (error) {
      showToast('Erro ao verificar instâncias', 'error');
      addLog(`Erro: ${String(error)}`, 'error');
    } finally {
      setVerifyingAll(false);
    }
  };

  const handleOpenSummaryModal = async () => {
    setShowSummaryModal(true);
    setSummaryLoading(true);
    try {
      const response = await fetch('/api/instances/summary', { headers: { 'X-User-Id': userId! } });
      const data = await response.json();
      if (response.ok && data.success && Array.isArray(data.data)) {
        setSummaryData(data.data);
      } else {
        setSummaryData([]);
      }
    } catch {
      setSummaryData([]);
    } finally {
      setSummaryLoading(false);
    }
  };


  // Timer do QR Code - inicia quando o modal abre com timer = 30
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Inicia o timer quando o modal abre e o timer é setado para 30
  useEffect(() => {
    if (!isQRModalOpen || qrTimer <= 0) {
      return;
    }

    // Limpa timer anterior se existir
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
    }

    setQrExpired(false);
    
    // Inicia o timer
    timerIntervalRef.current = setInterval(() => {
      setQrTimer(prev => {
        if (prev <= 1) {
          if (timerIntervalRef.current) {
            clearInterval(timerIntervalRef.current);
            timerIntervalRef.current = null;
          }
          setQrExpired(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Cleanup
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [isQRModalOpen, qrTimer > 0 && qrTimer === QR_WINDOW_SECONDS]); // Reinicia apenas quando o timer é resetado para o valor máximo

  // Limpa o timer quando o modal fecha
  useEffect(() => {
    if (!isQRModalOpen) {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
  }, [isQRModalOpen]);

  // Quando o timer expira e a instância não conectou, busca um novo QR code
  // MAS: Se for reconexão, não gera novo QR code - apenas verifica status
  useEffect(() => {
    if (!qrExpired || !isQRModalOpen || !currentConnectingInstance || !userId) {
      return;
    }

    // Timer expirou e instância não conectou
    const refreshExpiredQrCode = async () => {
      try {
        // Se for reconexão, apenas verifica status (não gera novo QR)
        if (isReconnecting) {
          console.log(`⏰ Timer expirado para reconexão ${currentConnectingInstance}. Verificando status (GET)...`);
          const response = await fetchStatusWithTimeout(`/api/instances/${currentConnectingInstance}/status`, {
            method: 'GET',
            headers: { 'X-User-Id': userId },
          });
          const data = await response.json();
          
          if (data.success && data.data) {
            if (data.data.status === 'connected') {
              console.log(`✅ Instância ${currentConnectingInstance} conectou durante reconexão. Fechando modal.`);
              setIsQRModalOpen(false);
              setQrCode('');
              setQrTimer(0);
              setQrExpired(false);
              setCurrentConnectingInstance(null);
              const wasReconnecting = isReconnecting;
              setIsReconnecting(false);
              
              // Não mostra modal para reconexões
              await loadInitialData();
            } else {
              // Ainda não conectou, mas não gera novo QR - fecha modal e atualiza página
              console.log(`⏰ QR Code de reconexão expirado para ${currentConnectingInstance}. Fechando modal e atualizando página...`);
              setIsQRModalOpen(false);
              setQrCode('');
              setQrTimer(0);
              setQrExpired(false);
              setCurrentConnectingInstance(null);
              setIsReconnecting(false);
              showToast('QR Code expirado. Verifique o status da instância.', 'info');
              await loadInitialData();
              window.location.reload();
            }
          } else {
            // Se a resposta não foi bem-sucedida na reconexão, fecha modal e atualiza página
            console.log('⚠️ Resposta não foi bem-sucedida na reconexão após expiração. Fechando modal e atualizando página...');
            setIsQRModalOpen(false);
            setQrCode('');
            setQrTimer(0);
            setQrExpired(false);
            setCurrentConnectingInstance(null);
            setIsReconnecting(false);
            await loadInitialData();
            window.location.reload();
          }
        } else {
          // Para criação, busca novo QR code
          console.log(`⏰ Timer expirado para instância ${currentConnectingInstance}. Solicitando novo QR Code (POST)...`);
          
          // Usa POST para forçar a reconexão/geração de novo QR (com timeout)
          const response = await fetchStatusWithTimeout(`/api/instances/${currentConnectingInstance}/status`, {
            method: 'POST',
            headers: { 'X-User-Id': userId },
          });
          const data = await response.json();
          
          if (data.success && data.data) {
            if (data.data.status === 'connected') {
              console.log(`✅ Instância ${currentConnectingInstance} já conectou. Fechando modal.`);
              setIsQRModalOpen(false);
              setQrCode('');
              setQrTimer(0);
              setQrExpired(false);
              setCurrentConnectingInstance(null);
              const wasReconnecting = isReconnecting;
              setIsReconnecting(false);
              
              // Mostra modal apenas para novas instâncias (não reconexões) e apenas uma vez
              showExtractGroupsModalIfNeeded(currentConnectingInstance, !wasReconnecting);
              await loadInitialData();
            } else if (data.data.qrCode) {
              console.log(`🔄 Novo QR Code recebido para ${currentConnectingInstance}. Reiniciando timer.`);
              setQrCode(data.data.qrCode);
              setQrTimer(QR_WINDOW_SECONDS); // Isso deve disparar o useEffect do timer
              setQrExpired(false);
              showToast('QR Code atualizado automaticamente.', 'info');
            } else {
              // Se não retornou QR imediato no POST, tenta um GET em seguida (com timeout)
              console.log('⚠️ POST não retornou QR imediato, tentando GET status...');
              const getRes = await fetchStatusWithTimeout(`/api/instances/${currentConnectingInstance}/status`, {
                headers: { 'X-User-Id': userId },
              });
              const getData = await getRes.json();
              if (getData.success && getData.data?.qrCode) {
                setQrCode(getData.data.qrCode);
                setQrTimer(QR_WINDOW_SECONDS);
                setQrExpired(false);
              } else {
                // Se não conseguiu obter novo QR code após expiração, fecha modal e atualiza página
                console.log('⚠️ Não foi possível obter novo QR code após expiração. Fechando modal e atualizando página...');
                setIsQRModalOpen(false);
                setQrCode('');
                setQrTimer(0);
                setQrExpired(false);
                setCurrentConnectingInstance(null);
                setIsReconnecting(false);
                await loadInitialData();
                window.location.reload();
              }
            }
          } else {
            // Se a resposta não foi bem-sucedida, fecha modal e atualiza página
            console.log('⚠️ Resposta não foi bem-sucedida após expiração. Fechando modal e atualizando página...');
            setIsQRModalOpen(false);
            setQrCode('');
            setQrTimer(0);
            setQrExpired(false);
            setCurrentConnectingInstance(null);
            setIsReconnecting(false);
            await loadInitialData();
            window.location.reload();
          }
        }
      } catch (error) {
        console.error('❌ Erro ao atualizar QR Code expirado:', error);
        // Em caso de erro, fecha o modal e atualiza a página
        console.log('🔄 Fechando modal QR code e atualizando página devido a erro...');
        setIsQRModalOpen(false);
        setQrCode('');
        setQrTimer(0);
        setQrExpired(false);
        setCurrentConnectingInstance(null);
        setIsReconnecting(false);
        // Recarrega os dados da página
        await loadInitialData();
        // Atualiza a página para garantir sincronização
        window.location.reload();
      }
    };

    refreshExpiredQrCode();
  }, [qrExpired, isQRModalOpen, currentConnectingInstance, userId, isReconnecting, showToast, loadInitialData]);

  // Polling inteligente: verifica status apenas quando o modal está aberto
  // Verifica a cada 1 segundo se for reconexão, ou a cada 3 segundos se for criação
  // IMPORTANTE: O polling só funciona enquanto o modal está aberto e currentConnectingInstance está setado
  // Quando o usuário fecha o modal, currentConnectingInstance é limpo e o polling para
  useEffect(() => {
    // Só faz polling se o modal estiver aberto E houver uma instância conectando
    if (!isQRModalOpen || !currentConnectingInstance || !userId) {
      return;
    }

    // Polling para verificar status da instância enquanto o modal está aberto
    const checkConnectionStatus = async () => {
      try {
        // Usa GET para verificar status real na Evolution API (com timeout)
        const response = await fetchStatusWithTimeout(`/api/instances/${currentConnectingInstance}/status`, {
          method: 'GET',
          headers: { 'X-User-Id': userId },
        });
        const data = await response.json();
        
        if (data.success && data.data) {
          const status = data.data.status; // Status real da Evolution API
          
          // Só fecha o modal se o status for EXATAMENTE 'connected' na Evolution API
          // Não fecha para 'connecting' ou qualquer outro status
          if (status === 'connected') {
            console.log(`✅ Instância ${currentConnectingInstance} conectou na Evolution API! Fechando modal QR code.`);
            
            setIsQRModalOpen(false);
            setQrCode('');
            setQrTimer(0);
            setQrExpired(false);
            setCurrentConnectingInstance(null);
            const wasReconnecting = isReconnecting;
            setIsReconnecting(false);
            
            // Mostra modal apenas para novas instâncias (não reconexões) e apenas uma vez
            showExtractGroupsModalIfNeeded(currentConnectingInstance, !wasReconnecting);
            
            // Recarrega dados após conectar (o banco já foi atualizado pela API)
            await loadInitialData();
          } else if (status === 'connecting' && data.data.qrCode && !isReconnecting) {
            // Se ainda está conectando e tem novo QR code, atualiza APENAS se não for reconexão
            // Na reconexão, mantém o QR code original e não atualiza
            // Mas NÃO fecha o modal - continua aguardando
            setQrCode(data.data.qrCode);
            setQrTimer(QR_WINDOW_SECONDS); // Reseta o timer se houver novo QR
          }
          // Se for reconexão e tiver novo QR code, IGNORA - mantém o QR original
        }
      } catch (error) {
        console.error('Erro ao verificar status da instância:', error);
        // Não fecha o modal em caso de erro - continua aguardando
      }
    };

    // Verifica imediatamente
    checkConnectionStatus();
    
    // Define intervalo baseado no tipo: 1 segundo para reconexão, 3 segundos para criação
    const intervalTime = isReconnecting ? 1000 : 3000;
    const interval = setInterval(checkConnectionStatus, intervalTime);

    return () => clearInterval(interval);
  }, [isQRModalOpen, currentConnectingInstance, userId, isReconnecting, showToast, loadInitialData]);

  // Verifica se a instância que está conectando realmente conectou (fallback)
  // Este useEffect é um backup caso o polling acima não detecte
  // IMPORTANTE: Este fallback só funciona enquanto o modal está aberto
  // Quando o modal fecha, currentConnectingInstance é limpo e este efeito para de funcionar
  useEffect(() => {
    if (!isQRModalOpen || !currentConnectingInstance || instances.length === 0) {
      return;
    }

    // Busca a instância específica que está conectando
    const targetInstance = instances.find(inst => inst.instance_name === currentConnectingInstance);
    
    // Só fecha o modal se o status for EXATAMENTE 'connected' ou 'ok' no banco
    // Mas só confia se o modal ainda estiver aberto (não foi fechado manualmente)
    if (targetInstance && (targetInstance.status === 'connected' || targetInstance.status === 'ok')) {
      console.log(`✅ Instância ${currentConnectingInstance} conectou (via fallback)! Fechando modal QR code.`);
      setIsQRModalOpen(false);
      setQrCode('');
      setQrTimer(0);
      setQrExpired(false);
      setCurrentConnectingInstance(null);
      const wasReconnecting = isReconnecting;
      setIsReconnecting(false);
      
      // Mostra modal apenas para novas instâncias (não reconexões) e apenas uma vez
      showExtractGroupsModalIfNeeded(currentConnectingInstance, !wasReconnecting);
    }
  }, [instances, isQRModalOpen, currentConnectingInstance, showToast]);

  const handleSignOut = async () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
    }
    window.location.href = '/login';
  };

  const copyApiKey = (hash: string) => {
    navigator.clipboard.writeText(hash);
    showToast('API Key copiada!', 'success');
  };


  // Lógica de filtro e paginação de instâncias
  const getFilteredInstances = () => {
    let filtered = instances;
    
    // Aplicar filtro por status
    if (instanceFilter === 'connected') {
      // Filtra instâncias com status 'connected' ou 'ok'
      filtered = instances.filter(inst => 
        inst.status === 'connected' || inst.status === 'ok'
      );
    } else if (instanceFilter === 'disconnected') {
      // Filtra instâncias que NÃO estão conectadas
      // Inclui: 'disconnected', 'connecting', e qualquer outro status que não seja 'connected' ou 'ok'
      filtered = instances.filter(inst => {
        const status = inst.status?.toLowerCase();
        return status !== 'connected' && status !== 'ok';
      });
    }
    // Se instanceFilter === 'todas', não filtra nada
    
    // Ordena: instâncias mestres primeiro, depois as demais
    filtered.sort((a, b) => {
      const aIsMaster = (a as any).is_master === true;
      const bIsMaster = (b as any).is_master === true;
      
      if (aIsMaster && !bIsMaster) return -1; // a vem antes
      if (!aIsMaster && bIsMaster) return 1;  // b vem antes
      return 0; // mantém ordem original se ambas têm mesmo tipo
    });
    
    return filtered;
  };

  const filteredInstances = getFilteredInstances();
  const totalInstancePages = Math.ceil(filteredInstances.length / instanceItemsPerPage);
  const startInstanceIndex = (instanceCurrentPage - 1) * instanceItemsPerPage;
  const endInstanceIndex = startInstanceIndex + instanceItemsPerPage;
  const paginatedInstances = filteredInstances.slice(startInstanceIndex, endInstanceIndex);

  // Resetar página quando o filtro mudar
  useEffect(() => {
    setInstanceCurrentPage(1);
  }, [instanceFilter]);

  // Verifica se há instância mestre conectada
  const hasMasterInstanceConnected = instances.some(
    inst => (inst as any).is_master === true && (inst.status === 'connected' || inst.status === 'ok')
  );


  if (checking || userId === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200 text-center">
          <p className="text-gray-700 font-medium">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <Layout onSignOut={handleSignOut}>
      {/* Toasts */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`flex items-center gap-3 min-w-[320px] px-6 py-4 rounded-lg shadow-lg text-white ${
              toast.type === 'success' ? 'bg-emerald-600' : toast.type === 'error' ? 'bg-red-600' : 'bg-amber-500'
            }`}
          >
            {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 flex-shrink-0" />}
            {toast.type === 'error' && <AlertCircle className="w-5 h-5 flex-shrink-0" />}
            {toast.type === 'info' && <Info className="w-5 h-5 flex-shrink-0" />}
            <p className="flex-1 font-medium">{toast.message}</p>
            <button
              onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
              className="hover:bg-white/20 rounded p-1 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="space-y-6 w-full">
        {/* Aviso sobre instância mestre */}
        {!hasMasterInstanceConnected && (
          <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-amber-800 mb-1">Instância Mestre Necessária</p>
              <p className="text-sm text-amber-700">
                Para usar o Zaploto, você precisa ter uma instância mestre conectada. 
                Crie e conecte uma instância mestre para desbloquear todas as funcionalidades do sistema.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-white mb-2">Instâncias WhatsApp</h1>
            <p className="text-sm sm:text-base text-gray-600">Gerencie suas instâncias e grupos</p>
          </div>
          {/* Botão Toggle da Sidebar - Apenas no mobile, no topo direito */}
          <div className="lg:hidden flex-shrink-0">
            <button
              onClick={() => setIsMobileOpen(!isMobileOpen)}
              className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-gray-100 transition text-gray-600 shadow-md bg-white"
              aria-label="Toggle sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="space-y-6">
          {/* Banner: grupos sendo processados em segundo plano */}
          {groupsProcessingForInstance && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#8CD955]/15 dark:bg-[#8CD955]/20 border border-[#8CD955]/40 dark:border-[#8CD955]/30 text-gray-800 dark:text-gray-100">
              <Loader2 className="w-5 h-5 flex-shrink-0 animate-spin text-[#8CD955]" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm sm:text-base">
                  Grupos da instância <span className="font-semibold text-[#5a8a2a] dark:text-[#8CD955]">{groupsProcessingForInstance}</span> estão sendo processados em segundo plano.
                </p>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                  Você será avisado quando a extração e sincronização terminarem. Pode continuar usando a página.
                </p>
              </div>
            </div>
          )}

          {/* Lista de Instâncias */}
          <div className="bg-gray-100 dark:bg-[#2a2a2a] rounded-xl shadow-md p-6 border border-gray-200 dark:border-[#404040]" data-tour-id="instancias-conectadas">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
              <h2 className="text-lg font-semibold text-gray-800 dark:text-white">Lista de Instâncias</h2>
              
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleOpenSummaryModal}
                  disabled={instances.length === 0}
                  className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-[#333] hover:bg-gray-200 dark:hover:bg-[#404040] text-gray-700 dark:text-gray-200 rounded-lg font-medium transition shadow-sm disabled:opacity-50"
                >
                  <Info className="w-4 h-4" />
                  Ver resumo
                </button>
                <button
                  onClick={handleVerifyAllInstances}
                  disabled={verifyingAll || instances.length === 0}
                  className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition shadow-sm disabled:opacity-50"
                >
                  {verifyingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Verificar todas
                </button>
                <button
                  onClick={() => setIsCreateModalOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-[#8CD955] hover:bg-[#7BC84A] text-white rounded-lg font-medium transition shadow-md"
                >
                  <Plus className="w-5 h-5" />
                  Criar Instância
                </button>
              </div>
            </div>
            
            {isLoadingInstances ? (
              <>
                {/* Loading State */}
                <div className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <RefreshCw className="w-8 h-8 text-[#8CD955] animate-spin mx-auto mb-4" />
                    <p className="text-gray-600 dark:text-[#aaa] font-medium">Carregando instâncias...</p>
                  </div>
                </div>
              </>
            ) : instances.length > 0 ? (
              <>
                {/* Filtros de Status */}
                <div className="flex flex-wrap gap-2 mb-4">
                  <button
                    onClick={() => setInstanceFilter('todas')}
                    className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                      instanceFilter === 'todas'
                        ? 'bg-[#8CD955] dark:bg-[#00ff00] text-white'
                        : 'bg-gray-100 dark:bg-[#333] text-gray-600 dark:text-[#ccc] hover:bg-gray-200 dark:hover:bg-[#404040]'
                    }`}
                  >
                    Todas ({instances.length})
                  </button>
                  <button
                    onClick={() => setInstanceFilter('connected')}
                    className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                      instanceFilter === 'connected'
                        ? 'bg-[#8CD955] dark:bg-[#00ff00] text-white'
                        : 'bg-[#8CD95515] dark:bg-[#00ff0015] text-[#6AB83D] dark:text-[#00ff00] hover:bg-[#8CD95525] dark:hover:bg-[#00ff0025]'
                    }`}
                  >
                    Conectadas ({instances.filter(i => i.status === 'connected' || i.status === 'ok').length})
                  </button>
                  <button
                    onClick={() => setInstanceFilter('disconnected')}
                    className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                      instanceFilter === 'disconnected'
                        ? 'bg-red-600 text-white'
                        : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30'
                    }`}
                  >
                    Desconectadas ({instances.filter(i => {
                      const status = i.status?.toLowerCase();
                      return status !== 'connected' && status !== 'ok';
                    }).length})
                  </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredInstances.length === 0 ? (
                    <div className="col-span-full">
                      <p className="text-sm text-gray-500 dark:text-[#888] text-center py-4">Nenhuma instância encontrada com o filtro selecionado</p>
                    </div>
                  ) : (
                    <>
                      {paginatedInstances.map(inst => {
                        const connected = inst.status === 'connected' || inst.status === 'ok';
                        const connecting = inst.status === 'connecting';
                        // Verifica se a instância está bloqueada (API Evolution bloqueada para criação de instâncias)
                        const isBlocked = !!inst.is_blocked_for_instances;
                        
                        // Debug: log para verificar se instâncias bloqueadas estão chegando no frontend
                        if (isBlocked) {
                          console.log(`[Frontend Instances] Instância BLOQUEADA encontrada: ${inst.instance_name}`, {
                            is_blocked_for_instances: inst.is_blocked_for_instances,
                            type: typeof inst.is_blocked_for_instances,
                            status: inst.status,
                            user_id: inst.user_id
                          });
                        }
                        
                        return (
                          <div key={inst.id || inst.instance_name} className="p-5 border-2 border-gray-200 dark:border-[#404040] rounded-lg hover:border-[#8CD95540] dark:hover:border-[#00ff0040] hover:bg-[#8CD95515] dark:hover:bg-[#00ff0015] transition-all duration-200 bg-white dark:bg-[#333] flex flex-col h-full shadow-sm">
                            <div className="flex justify-between items-start mb-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                  <span className="font-semibold text-gray-800 dark:text-white truncate">{inst.instance_name}</span>
                                  {/* Selo Em Maturação (virgem, bloqueada) */}
                                  {(inst as any).is_locked === true && (inst as any).maturation_type === 'virgem' && (
                                    <span
                                      className="px-2 py-1 rounded text-xs font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 flex items-center gap-1 flex-shrink-0"
                                      title="Instância em auto maturação por 5 dias - bloqueada para campanhas e fluxos"
                                    >
                                      <Lock className="w-3 h-3" />
                                      Em Maturação
                                      {(inst as any).current_day != null && (
                                        <span className="ml-0.5">(Dia {(inst as any).current_day}/5)</span>
                                      )}
                                      {(inst as any).maturation_ends_at && (() => {
                                        const end = new Date((inst as any).maturation_ends_at).getTime();
                                        const now = Date.now();
                                        const ms = Math.max(0, end - now);
                                        const days = Math.floor(ms / (24 * 60 * 60 * 1000));
                                        const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
                                        return days > 0 ? ` · ${days}d ${hours}h` : ` · ${hours}h`;
                                      })()}
                                    </span>
                                  )}
                                  {/* Marcador visual para instância mestre */}
                                  {(inst as any).is_master === true && (
                                    <span
                                      className="px-2 py-1 rounded text-xs font-bold bg-gradient-to-r from-yellow-400 to-yellow-500 text-yellow-900 flex items-center gap-1 shadow-sm flex-shrink-0"
                                      title="Instância Mestre - Usada para ativações e Agentes IA"
                                    >
                                      <Star className="w-3 h-3 fill-yellow-900" />
                                      MESTRE
                                    </span>
                                  )}
                                  <span
                                    className={`px-2 py-1 rounded text-xs font-medium flex-shrink-0 ${
                                      connected
                                        ? 'bg-[#8CD95515] dark:bg-[#00ff0015] text-[#6AB83D] dark:text-[#00ff00]'
                                        : connecting
                                        ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                                        : 'bg-gray-100 dark:bg-[#404040] text-gray-600 dark:text-[#aaa]'
                                    }`}
                                  >
                                    {connected ? 'Conectado' : connecting ? 'Conectando' : inst.status === 'disconnected' ? 'Desconectado' : inst.status}
                                  </span>
                                </div>
                                {inst.number && (
                                  <p className="text-sm text-gray-600 dark:text-[#aaa] mb-2 flex items-center gap-1">
                                    <Phone className="w-3 h-3 text-indigo-500" />
                                    {inst.number}
                                  </p>
                                )}
                                <div className="flex flex-wrap gap-2 mb-2">
                                  {/* Indicador de Proxy */}
                                  {inst.proxy && (
                                    <span
                                      className="px-2 py-1 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 flex items-center gap-1 flex-shrink-0"
                                      title={`Proxy: ${inst.proxy.name} (${inst.proxy.host})`}
                                    >
                                      <LinkIcon className="w-3 h-3" />
                                      {inst.proxy.name || 'Proxy'}
                                    </span>
                                  )}
                                  {/* Badge de API Bloqueada - Mostra quando a API Evolution está bloqueada para criação de instâncias */}
                                  {isBlocked && (
                                    <span
                                      className="px-2 py-1 rounded text-xs font-medium bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300 flex items-center gap-1 flex-shrink-0"
                                      title="API Evolution bloqueada para criação de novas instâncias. Esta instância ainda pode ser usada para adicionar pessoas em grupos e enviar mensagens."
                                    >
                                      <Lock className="w-3 h-3" />
                                      BLOQUEADO
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex gap-1 flex-shrink-0 ml-2">
                                {inst.hash && (
                                  <button
                                    onClick={() => copyApiKey(inst.hash!)}
                                    className="p-2 hover:bg-gray-100 dark:hover:bg-[#404040] rounded-lg transition text-gray-400 dark:text-[#888] hover:text-gray-600 dark:hover:text-white"
                                    title="Copiar API Key"
                                  >
                                    <Copy className="w-4 h-4" />
                                  </button>
                                )}
                                <button
                                  onClick={() => handleDeleteInstance(inst)}
                                  className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition text-gray-400 dark:text-[#888] hover:text-red-600 dark:hover:text-red-400"
                                    title="Deletar instância"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                            {inst.hash && (
                              <div className="mb-4 p-2 bg-gray-50 dark:bg-[#404040] border border-gray-100 dark:border-[#555] rounded-lg text-[10px] font-mono break-all text-gray-400 dark:text-[#aaa] flex items-center justify-center">
                                {inst.hash}
                              </div>
                            )}
                            <div className="flex gap-2 mt-auto">
                              {!connected && (
                                <button
                                  onClick={() => handleReconnect(inst)}
                                  disabled={loading}
                                  className="flex-1 h-10 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs sm:text-sm font-semibold transition-all shadow-sm hover:shadow-md active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
                                >
                                  <LinkIcon className="w-4 h-4" />
                                  <span className="hidden sm:inline">Reconectar</span>
                                </button>
                              )}
                              <button
                                onClick={() => handleOpenPhoneModal(inst)}
                                className="flex-1 h-10 px-3 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 border border-indigo-200 dark:border-indigo-700 rounded-xl text-xs sm:text-sm font-semibold transition-all active:scale-95 flex items-center justify-center gap-1.5"
                                title="Configurar Telefone"
                              >
                                <Phone className="w-4 h-4" />
                                <span className="hidden sm:inline">Telefone</span>
                              </button>
                              <button
                                onClick={() => handleCheckStatus(inst)}
                                disabled={checkingInstance === inst.instance_name}
                                className="flex-1 h-10 px-3 bg-[#8CD955] hover:bg-[#7BC84A] text-white rounded-xl text-xs sm:text-sm font-semibold transition-all shadow-sm hover:shadow-md active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
                              >
                                <RefreshCw 
                                  className={`w-4 h-4 ${checkingInstance === inst.instance_name ? 'animate-spin' : ''}`} 
                                />
                                <span className="hidden sm:inline">{checkingInstance === inst.instance_name ? '...' : 'Verificar'}</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      
                      {/* Paginação */}
                      {totalInstancePages > 1 && (
                        <div className="col-span-full mt-4 pt-4 border-t border-gray-200">
                          <Pagination
                            currentPage={instanceCurrentPage}
                            totalPages={totalInstancePages}
                            onPageChange={setInstanceCurrentPage}
                            itemsPerPage={instanceItemsPerPage}
                            totalItems={filteredInstances.length}
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-12">
                <MessageSquare className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 text-lg font-medium mb-2">Nenhuma instância criada</p>
                <p className="text-gray-400 text-sm mb-4">Crie sua primeira instância para começar</p>
                <button
                  onClick={() => setIsCreateModalOpen(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#8CD955] hover:bg-[#7BC84A] text-white rounded-lg font-medium transition shadow-md"
                >
                  <Plus className="w-5 h-5" />
                  Criar Instância
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal de Criação de Instância */}
      {isCreateModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !loading) {
              setIsCreateModalOpen(false);
            }
          }}
        >
          {/* Overlay */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          
          {/* Modal - largo para melhor visualização */}
          <div className="relative bg-white dark:bg-[#2a2a2a] rounded-xl shadow-2xl max-w-4xl w-full z-10 animate-in fade-in zoom-in duration-200 overflow-hidden border border-gray-200 dark:border-[#404040]">
            <div className="p-6">
            {/* Header */}
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-xl font-semibold text-gray-800 dark:text-white">Criar Nova Instância</h2>
              <button
                onClick={() => !loading && setIsCreateModalOpen(false)}
                disabled={loading}
                className="p-2 hover:bg-gray-100 dark:hover:bg-[#333] rounded-lg transition text-gray-500 dark:text-[#aaa] hover:text-gray-700 dark:hover:text-white disabled:opacity-50"
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Conteúdo do Modal - layout horizontal */}
            <div className="space-y-5">
              {/* Linha 1: API + Nome da Instância lado a lado */}
              <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-5 items-start">
                {/* Tipo de API (compacto) */}
                <div className="min-w-0">
                  <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-2">Tipo de API*</label>
                  <div className="border-2 border-gray-200 dark:border-[#555] rounded-lg p-3 bg-[#8CD95515] dark:bg-[#00ff0015] cursor-pointer hover:border-[#8CD955] dark:hover:border-[#00ff00] transition">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 shrink-0 bg-[#8CD955] dark:bg-[#00ff00] rounded-lg flex items-center justify-center">
                        <MessageSquare className="w-5 h-5 text-white" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-800 dark:text-white text-sm">API WhatsApp (Não Oficial)</p>
                        <p className="text-xs text-gray-500 dark:text-[#aaa]">Evolution API - Baileys</p>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Nome da Instância */}
                <div className="min-w-0">
                  <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-2">Nome da Instância*</label>
                  <input
                    type="text"
                    value={instanceName}
                    onChange={e => {
                      const value = e.target.value.replace(/[^a-zA-Z0-9_]/g, '');
                      setInstanceName(value);
                    }}
                    placeholder="Ex: teste1, adicione1, consultorjão, teste_teste"
                    disabled={loading}
                    className="w-full px-4 py-3 border-2 border-gray-200 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[#8CD955] dark:focus:ring-[#00ff00] focus:border-[#8CD955] dark:focus:border-[#00ff00] text-gray-700 dark:text-white dark:bg-[#333] placeholder:text-gray-400 dark:placeholder:text-[#888] disabled:opacity-50"
                  />
                  <p className="text-xs text-gray-500 dark:text-[#888] mt-1">Apenas letras, números e underscore (_)</p>
                </div>
              </div>

              {/* Linha 2: Tipo de Instância e Tipo de Maturação — colunas alinhadas e altura uniforme (consultor e admin) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
                {/* Tipo de Instância */}
                <div className="flex flex-col">
                  <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-2 h-5 flex items-center">Tipo de Instância*</label>
                  <div className="grid grid-rows-2 gap-2 flex-1 min-h-[140px]">
                    <div
                      onClick={() => !loading && setIsMaster(true)}
                      className={`border-2 rounded-lg p-3 transition flex items-center gap-3 min-h-[64px] ${
                        isMaster ? 'border-[#8CD955] dark:border-[#00ff00] bg-[#8CD95515] dark:bg-[#00ff0015] cursor-pointer' : 'border-gray-200 dark:border-[#555] hover:border-[#8CD95540] dark:hover:border-[#00ff0040] hover:bg-gray-50 dark:hover:bg-[#333] cursor-pointer'
                      } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <div className={`w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center ${
                        isMaster ? 'border-[#8CD955] dark:border-[#00ff00] bg-[#8CD955] dark:bg-[#00ff00]' : 'border-gray-300 dark:border-[#555]'
                      }`}>
                        {isMaster && <div className="w-3 h-3 rounded-full bg-white" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <Star className="w-4 h-4 text-yellow-500 fill-yellow-500 shrink-0" />
                          <span className="font-semibold text-gray-800 dark:text-white text-sm">Instância Mestre</span>
                        </div>
                        <p className="text-xs text-gray-600 dark:text-[#aaa] leading-snug">
                          Mensagens, Agentes IA, Anti-Spam e Boas-Vindas. Sem proxy automático. Instâncias mestres ilimitadas.
                        </p>
                      </div>
                    </div>
                    <div
                      onClick={() => !loading && setIsMaster(false)}
                      className={`border-2 rounded-lg p-3 cursor-pointer transition flex items-center gap-3 min-h-[64px] ${
                        !isMaster ? 'border-[#8CD955] dark:border-[#00ff00] bg-[#8CD95515] dark:bg-[#00ff0015]' : 'border-gray-200 dark:border-[#555] hover:border-[#8CD95540] dark:hover:border-[#00ff0040] hover:bg-gray-50 dark:hover:bg-[#333]'
                      } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <div className={`w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center ${
                        !isMaster ? 'border-[#8CD955] dark:border-[#00ff00] bg-[#8CD955] dark:bg-[#00ff00]' : 'border-gray-300 dark:border-[#555]'
                      }`}>
                        {!isMaster && <div className="w-3 h-3 rounded-full bg-white" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <Zap className="w-4 h-4 text-blue-500 shrink-0" />
                          <span className="font-semibold text-gray-800 dark:text-white text-sm">Instância Normal</span>
                        </div>
                        <p className="text-xs text-gray-600 dark:text-[#aaa] leading-snug">
                          Campanhas em massa e criar grupos via API. Proxy vinculado automaticamente.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Tipo de Maturação — visível para consultor e admin */}
                <div className="flex flex-col">
                  <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-2 h-5 flex items-center">Tipo de Maturação*</label>
                  <div className="grid grid-rows-2 gap-2 flex-1 min-h-[140px]">
                    <div
                      onClick={() => !loading && setMaturationType('maturado')}
                      className={`border-2 rounded-lg p-3 cursor-pointer transition flex items-center gap-3 min-h-[64px] ${
                        maturationType === 'maturado' ? 'border-[#8CD955] dark:border-[#00ff00] bg-[#8CD95515] dark:bg-[#00ff0015]' : 'border-gray-200 dark:border-[#555] hover:border-[#8CD95540] dark:hover:border-[#00ff0040] hover:bg-gray-50 dark:hover:bg-[#333]'
                      } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <div className={`w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center ${
                        maturationType === 'maturado' ? 'border-[#8CD955] dark:border-[#00ff00] bg-[#8CD955] dark:bg-[#00ff00]' : 'border-gray-300 dark:border-[#555]'
                      }`}>
                        {maturationType === 'maturado' && <div className="w-3 h-3 rounded-full bg-white" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="font-semibold text-gray-800 dark:text-white text-sm block mb-0.5">Maturado</span>
                        <p className="text-xs text-gray-600 dark:text-[#aaa] leading-snug">
                          Número já maturado. Pode operar normalmente após conectar.
                        </p>
                      </div>
                    </div>
                    <div
                      onClick={() => !loading && setMaturationType('virgem')}
                      className={`border-2 rounded-lg p-3 cursor-pointer transition flex items-center gap-3 min-h-[64px] ${
                        maturationType === 'virgem' ? 'border-[#8CD955] dark:border-[#00ff00] bg-[#8CD95515] dark:bg-[#00ff0015]' : 'border-gray-200 dark:border-[#555] hover:border-[#8CD95540] dark:hover:border-[#00ff0040] hover:bg-gray-50 dark:hover:bg-[#333]'
                      } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <div className={`w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center ${
                        maturationType === 'virgem' ? 'border-[#8CD955] dark:border-[#00ff00] bg-[#8CD955] dark:bg-[#00ff00]' : 'border-gray-300 dark:border-[#555]'
                      }`}>
                        {maturationType === 'virgem' && <div className="w-3 h-3 rounded-full bg-white" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="font-semibold text-gray-800 dark:text-white text-sm block mb-0.5">Virgem</span>
                        <p className="text-xs text-gray-600 dark:text-[#aaa] leading-snug">
                          Número novo. Após QR Code, auto maturação por 5 dias (bloqueada para campanhas/fluxos).
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Botão Criar */}
              <button
                onClick={handleCreateInstance}
                disabled={loading || !instanceName}
                className="w-full py-3 bg-[#8CD955] dark:bg-[#00ff00] hover:bg-[#7BC84A] dark:hover:bg-[#00e600] text-white rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    Criando...
                  </>
                ) : (
                  <>
                    <Plus className="w-5 h-5" />
                    Criar Instância
                  </>
                )}
              </button>
            </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Pergunta sobre Extrair Grupos */}
      {showExtractGroupsPrompt && newlyConnectedInstance && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowExtractGroupsPrompt(false);
              setNewlyConnectedInstance(null);
            }
          }}
        >
          {/* Overlay */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          
          {/* Modal */}
          <div className="relative bg-white dark:bg-[#2a2a2a] rounded-xl shadow-2xl p-6 max-w-md w-full z-10 animate-in fade-in zoom-in duration-200 border border-gray-200 dark:border-[#404040]">
            <div className="text-center mb-6">
              <CheckCircle2 className="w-16 h-16 text-[#8CD955] dark:text-[#00ff00] mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">Instância Conectada!</h2>
              <p className="text-gray-600 dark:text-[#ccc]">Deseja extrair e salvar todos os grupos desta instância?</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowExtractGroupsPrompt(false);
                  setNewlyConnectedInstance(null);
                  showToast('Instância conectada com sucesso!', 'success');
                }}
                className="flex-1 py-3 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg font-medium transition"
              >
                Fechar
              </button>
              <button
                onClick={() => {
                  const instanceName = newlyConnectedInstance;
                  setShowExtractGroupsPrompt(false);
                  setNewlyConnectedInstance(null);
                  showToast('Instância conectada com sucesso!', 'success');
                  if (instanceName) runExtractGroupsInBackground(instanceName);
                }}
                className="flex-1 py-3 bg-[#8CD955] hover:bg-[#7BC84A] text-white rounded-lg font-medium transition"
              >
                Extrair
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Telefone da Instância */}
      {isPhoneModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSavingPhone) {
              setIsPhoneModalOpen(false);
            }
          }}
        >
          {/* Overlay */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          
          {/* Modal */}
          <div className="relative bg-white rounded-xl shadow-2xl p-6 max-w-md w-full z-10 animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
                <Phone className="w-5 h-5 text-indigo-600" />
                Telefone da Instância
              </h2>
              <button
                onClick={() => !isSavingPhone && setIsPhoneModalOpen(false)}
                disabled={isSavingPhone}
                className="p-2 hover:bg-gray-100 rounded-lg transition text-gray-500 hover:text-gray-700 disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex gap-3">
                  <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-800">
                    Precisamos do número de telefone da instância (com DDI e DDD) para as operações de maturação.
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Número de Telefone (Ex: 5511999999999)
                </label>
                <input
                  type="text"
                  value={phoneValue}
                  onChange={(e) => setPhoneValue(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="DDI + DDD + Número"
                  className="w-full px-4 py-2 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-gray-700"
                  disabled={isSavingPhone}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setIsPhoneModalOpen(false)}
                  disabled={isSavingPhone}
                  className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSavePhone}
                  disabled={isSavingPhone || !phoneValue}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSavingPhone ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    'Salvar Número'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Resumo (tabela: nome, telefone, status, grupos) */}
      {showSummaryModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={(e) => e.target === e.currentTarget && setShowSummaryModal(false)}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative bg-white dark:bg-[#2a2a2a] rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col z-10 border border-gray-200 dark:border-[#404040]">
            <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-[#404040]">
              <h2 className="text-xl font-semibold text-gray-800 dark:text-white flex items-center gap-2">
                <Info className="w-5 h-5 text-[#8CD955]" />
                Resumo das instâncias
              </h2>
              <button
                onClick={() => setShowSummaryModal(false)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-[#333] rounded-lg transition text-gray-500 dark:text-[#aaa]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {summaryLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
                </div>
              ) : summaryData.length === 0 ? (
                <p className="text-gray-500 dark:text-[#aaa] text-center py-8">Nenhuma instância ou dados não disponíveis.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-[#404040]">
                        <th className="text-left py-3 px-2 font-semibold text-gray-700 dark:text-gray-300">Instância</th>
                        <th className="text-left py-3 px-2 font-semibold text-gray-700 dark:text-gray-300">Telefone</th>
                        <th className="text-left py-3 px-2 font-semibold text-gray-700 dark:text-gray-300">Status</th>
                        <th className="text-left py-3 px-2 font-semibold text-gray-700 dark:text-gray-300">Nº de grupos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaryData.map((row, idx) => (
                        <tr key={idx} className="border-b border-gray-100 dark:border-[#333] hover:bg-gray-50 dark:hover:bg-[#333]/50">
                          <td className="py-2 px-2 text-gray-800 dark:text-white font-medium">{row.instance_name}</td>
                          <td className="py-2 px-2 text-gray-600 dark:text-[#aaa]">{row.phone || '-'}</td>
                          <td className="py-2 px-2">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                              row.status === 'Conectada' ? 'bg-[#8CD955]/20 text-[#6AB83D] dark:text-[#00ff00]' :
                              row.status === 'Conectando' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' :
                              'bg-gray-100 dark:bg-[#404040] text-gray-600 dark:text-[#aaa]'
                            }`}>
                              {row.status}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-gray-600 dark:text-[#aaa]">
                            {row.groups_count ?? 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* QR Code Modal */}
      <QRCodeModal
        isOpen={isQRModalOpen}
        onClose={() => {
          // Quando fecha o modal sem escanear, para o polling e não atualiza status automaticamente
          console.log('🔒 Modal QR Code fechado manualmente. Parando polling e não atualizando status automaticamente.');
          setIsQRModalOpen(false);
          setQrCode('');
          setQrTimer(0);
          setQrExpired(false);
          // IMPORTANTE: Limpa currentConnectingInstance para parar o polling
          setCurrentConnectingInstance(null);
          setIsReconnecting(false);
          // NÃO recarrega dados automaticamente - deixa o usuário verificar manualmente
          showToast('Modal fechado. Use o botão "Verificar" para atualizar o status da instância.', 'info');
        }}
        qrCode={qrCode}
        qrTimer={qrTimer}
        qrExpired={qrExpired}
      />
    </Layout>
  );
};

export default InstancesPage;

