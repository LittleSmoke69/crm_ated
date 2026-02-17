'use client';

import React, { useState, useEffect, useRef } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Activity, Heart, Search, Plus, MoreVertical, Paperclip, X, Trash2, Edit2, Star, Info, Upload, ArrowLeft, Video, Phone, MoreVertical as MoreVerticalIcon, Smile, Camera, Mic, Check, CheckCheck, Send, Calendar, Clock, Play, Pause, Eye, Trash, Music } from 'lucide-react';
import SendActivationsModal from '@/components/CRM/SendActivationsModal';
import ScheduleDetailsModal from '@/components/CRM/ScheduleDetailsModal';
import { useToast } from '@/hooks/useToast';
import ToastContainer from '@/components/Toast/ToastContainer';
import { supabaseClient } from '@/lib/supabase/client';

interface Message {
  id: string;
  user_id: string;
  title: string;
  content: string;
  preview: string | null;
  category: string;
  is_favorite: boolean;
  has_attachment: boolean;
  mention_all: boolean;
  attachment_with_caption: boolean;
  message_type: string;
  attachment_url: string | null;
  attachment_type?: 'image' | 'video' | 'audio' | null;
  attachment_mime?: string | null;
  attachment_size?: number | null;
  send_intelligent?: boolean | null;
  training_asset_id?: string | null;
  training_dataset_item_id?: string | null;
  ptv_delay?: number | null;
  created_at: string;
  updated_at: string;
  profiles?: {
    id: string;
    email: string;
    full_name: string | null;
  };
}

/** Ocultar opção "Envio Inteligente" na UI por enquanto (pode ser reativada depois). */
const HIDE_SMART_SEND = true;

/** Timeout para upload (10 min) — evita travamento em conexões lentas com arquivos grandes. */
const UPLOAD_XHR_TIMEOUT_MS = 10 * 60 * 1000;

/** Upload de arquivo para URL assinada com progresso real (evita gargalos e mostra % real). */
function uploadFileWithProgress(
  signedUrl: string,
  file: File,
  options: { onProgress?: (percent: number) => void }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', signedUrl);
    xhr.timeout = UPLOAD_XHR_TIMEOUT_MS;
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && options.onProgress) {
        const percent = Math.round((e.loaded / e.total) * 100);
        options.onProgress(percent);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload falhou: ${xhr.status} ${xhr.statusText}`));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Erro de rede no upload')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelado')));
    xhr.addEventListener('timeout', () => reject(new Error('Upload demorou muito; tente novamente.')));

    xhr.send(file);
  });
}

const ActivationsPage = () => {
  const { checking, userId } = useRequireAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  
  // Envio de ativações
  const [showSendModal, setShowSendModal] = useState(false);
  const [messageToSend, setMessageToSend] = useState<Message | null>(null);
  
  // Tabs
  const [activeTab, setActiveTab] = useState<'messages' | 'schedules'>('messages');
  
  // Agendamentos
  const [schedules, setSchedules] = useState<any[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [scheduleSearchTitle, setScheduleSearchTitle] = useState('');
  const [scheduleFilterCreatedFrom, setScheduleFilterCreatedFrom] = useState('');
  const [scheduleFilterCreatedTo, setScheduleFilterCreatedTo] = useState('');
  const [scheduleFilterStatus, setScheduleFilterStatus] = useState<'all' | 'sent' | 'failed'>('all');
  const [scheduleFilterType, setScheduleFilterType] = useState<'all' | 'one_time' | 'recurring'>('all');
  const [recalculatingRecurring, setRecalculatingRecurring] = useState(false);

  // Toast
  const { toasts, showToast, removeToast } = useToast();
  
  // Preview de mídia
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video' | 'audio' | null>(null);
  
  // Loading de upload
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<string>('');

  // Form state
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    category: 'Boas vindas',
    has_attachment: false,
    attachment_with_caption: false,
    mention_all: false,
    message_type: 'text_only',
    attachment_url: null as string | null,
    send_intelligent: false,
    ptv_delay: 1200,
  });
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSignOut = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
      window.location.href = '/login';
    }
  };

  // Verifica se é admin
  useEffect(() => {
    const checkAdmin = async () => {
      if (!userId) return;
      try {
        const response = await fetch('/api/admin/check', {
          headers: { 'X-User-Id': userId },
        });
        const data = await response.json();
        setIsAdmin(data.data?.isAdmin || false);
      } catch (error) {
        console.error('Erro ao verificar admin:', error);
      }
    };
    checkAdmin();
  }, [userId]);

  // Carrega mensagens
  const loadMessages = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const response = await fetch('/api/crm/messages', {
        headers: { 'X-User-Id': userId },
      });
      const data = await response.json();
      if (response.ok) {
        setMessages(data.data || []);
      } else {
        console.error('Erro ao carregar mensagens:', data.error);
      }
    } catch (error) {
      console.error('Erro ao carregar mensagens:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (userId) {
      loadMessages();
    }
  }, [userId]);

  // Carrega agendamentos
  const loadSchedules = async () => {
    if (!userId) return;
    setLoadingSchedules(true);
    try {
      const response = await fetch('/api/crm/activations/schedules', {
        headers: { 'X-User-Id': userId },
      });
      const data = await response.json();
      if (response.ok) {
        setSchedules(data.data || []);
      } else {
        console.error('Erro ao carregar agendamentos:', data.error);
      }
    } catch (error) {
      console.error('Erro ao carregar agendamentos:', error);
    } finally {
      setLoadingSchedules(false);
    }
  };

  useEffect(() => {
    if (userId && activeTab === 'schedules') {
      loadSchedules();
    }
  }, [userId, activeTab]);

  // Recalcula próxima execução de todos os recorrentes (corrige dados antigos)
  const handleRecalculateRecurring = async () => {
    if (!userId || !isAdmin) return;
    setRecalculatingRecurring(true);
    try {
      const response = await fetch('/api/crm/activations/schedules/recalculate-recurring', {
        method: 'POST',
        headers: { 'X-User-Id': userId },
      });
      const data = await response.json();
      if (response.ok) {
        showToast(data.message || 'Próximas execuções recalculadas.', 'success');
        loadSchedules();
      } else {
        showToast(data.error || 'Erro ao recalcular.', 'error');
      }
    } catch (error) {
      console.error('Erro ao recalcular recorrentes:', error);
      showToast('Erro ao recalcular próximas execuções.', 'error');
    } finally {
      setRecalculatingRecurring(false);
    }
  };

  // Filtra mensagens por pesquisa
  const filteredMessages = messages.filter(msg => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      msg.title.toLowerCase().includes(query) ||
      msg.content.toLowerCase().includes(query) ||
      msg.preview?.toLowerCase().includes(query) ||
      msg.category.toLowerCase().includes(query)
    );
  });

  // Filtra agendamentos por título, data de criação, status e tipo
  const filteredSchedules = schedules.filter((schedule) => {
    const title = schedule.messages?.title || '';
    if (scheduleSearchTitle.trim()) {
      if (!title.toLowerCase().includes(scheduleSearchTitle.toLowerCase().trim())) return false;
    }
    if (scheduleFilterCreatedFrom) {
      const from = new Date(scheduleFilterCreatedFrom);
      from.setHours(0, 0, 0, 0);
      if (new Date(schedule.created_at) < from) return false;
    }
    if (scheduleFilterCreatedTo) {
      const to = new Date(scheduleFilterCreatedTo);
      to.setHours(23, 59, 59, 999);
      if (new Date(schedule.created_at) > to) return false;
    }
    if (scheduleFilterStatus !== 'all') {
      const statusNorm = String(schedule?.status ?? '').toLowerCase().trim();
      if (scheduleFilterStatus === 'sent' && statusNorm !== 'sent') return false;
      if (scheduleFilterStatus === 'failed' && statusNorm !== 'failed') return false;
    }
    if (scheduleFilterType !== 'all') {
      const isRecurring = schedule.schedule_type === 'recurring';
      const isPontual = schedule.schedule_type === 'once' || !isRecurring;
      if (scheduleFilterType === 'recurring' && !isRecurring) return false;
      if (scheduleFilterType === 'one_time' && !isPontual) return false;
    }
    return true;
  });

  // Agrupa por "disparo": mesma mensagem + mesma instância + mesma configuração (um card por disparo, listando todos os grupos)
  const scheduleGroupKey = (s: any) => {
    const rec =
      s.schedule_type === 'recurring'
        ? [(s.recurring_days || []).join(','), s.recurring_time ?? '', s.timezone ?? ''].join('|')
        : s.scheduled_at_utc ?? '';
    return `${s.message_id}|${s.instance_name}|${s.schedule_type}|${rec}`;
  };
  const groupedByDisparo = new Map<string, any[]>();
  for (const s of filteredSchedules) {
    const key = scheduleGroupKey(s);
    if (!groupedByDisparo.has(key)) groupedByDisparo.set(key, []);
    groupedByDisparo.get(key)!.push(s);
  }
  const scheduleGroups = Array.from(groupedByDisparo.entries()).map(([key, list]) => ({
    key,
    schedules: list,
  }));

  // Seleção
  const handleSelectAll = () => {
    if (selectedMessages.size === filteredMessages.length) {
      setSelectedMessages(new Set());
    } else {
      setSelectedMessages(new Set(filteredMessages.map(m => m.id)));
    }
  };

  const handleSelectMessage = (messageId: string) => {
    const newSelected = new Set(selectedMessages);
    if (newSelected.has(messageId)) {
      newSelected.delete(messageId);
    } else {
      newSelected.add(messageId);
    }
    setSelectedMessages(newSelected);
  };

  // Toggle favorito
  const handleToggleFavorite = async (messageId: string, currentFavorite: boolean) => {
    if (!userId) return;
    try {
      const response = await fetch(`/api/crm/messages/${messageId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
        body: JSON.stringify({ is_favorite: !currentFavorite }),
      });

      if (response.ok) {
        await loadMessages();
      } else {
        const data = await response.json();
        showToast(`Erro: ${data.error || 'Erro ao atualizar favorito'}`, 'error');
      }
    } catch (error) {
      console.error('Erro ao atualizar favorito:', error);
      showToast('Erro ao atualizar favorito', 'error');
    }
  };

  // Handle file upload com preview local
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Limpa preview anterior
    if (mediaPreviewUrl) {
      URL.revokeObjectURL(mediaPreviewUrl);
      setMediaPreviewUrl(null);
    }

    // Validação de tipo
    const mime = file.type;
    let detectedType: 'image' | 'video' | 'audio' | null = null;

    if (mime.startsWith('image/')) {
      detectedType = 'image';
    } else if (mime.startsWith('video/')) {
      detectedType = 'video';
    } else if (mime.startsWith('audio/')) {
      detectedType = 'audio';
    } else {
      showToast('Tipo de arquivo não suportado. Use imagem, vídeo ou áudio.', 'error');
      return;
    }

    // Se o usuário selecionou explicitamente "Vídeo" no tipo de mensagem, força vídeo
    if (formData.message_type === 'video' && detectedType !== 'video') {
      showToast('Para o tipo "Vídeo", selecione um arquivo de vídeo.', 'error');
      return;
    }
    if (formData.message_type === 'ptv' && detectedType !== 'video') {
      showToast('Vídeo de Bolinha (PTV) exige arquivo de vídeo (MP4, WEBM, OGG).', 'error');
      return;
    }

    // Se o usuário selecionou explicitamente "Áudio", força áudio
    if (formData.message_type === 'audio' && detectedType !== 'audio') {
      showToast('Para o tipo "Áudio", selecione um arquivo de áudio.', 'error');
      return;
    }

    // Validação de tamanho
    const MAX_SIZES = {
      image: 1024 * 1024 * 1024, // 1GB
      video: 1024 * 1024 * 1024, // 1GB
      audio: 1024 * 1024 * 1024, // 1GB
    };

    if (file.size > MAX_SIZES[detectedType]) {
      const maxMB = MAX_SIZES[detectedType] / (1024 * 1024);
      showToast(`${detectedType === 'image' ? 'Imagem' : detectedType === 'video' ? 'Vídeo' : 'Áudio'} muito grande. Máximo: ${maxMB}MB`, 'error');
      return;
    }

    // Cria preview local (sem upload)
    const url = URL.createObjectURL(file);
    setMediaPreviewUrl(url);
    setMediaType(detectedType);
    setAttachmentFile(file);
  };

  // Limpa preview ao remover arquivo
  const handleRemoveFile = () => {
    // Só revoga se for um ObjectURL local (blob:)
    // Se for uma URL do storage (http/https), não precisa revogar
    if (mediaPreviewUrl && mediaPreviewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(mediaPreviewUrl);
    }
    setMediaPreviewUrl(null);
    setMediaType(null);
    setAttachmentFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Cleanup de preview ao desmontar
  useEffect(() => {
    return () => {
      // Só revoga se for um ObjectURL local (blob:)
      if (mediaPreviewUrl && mediaPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(mediaPreviewUrl);
      }
    };
  }, [mediaPreviewUrl]);

  // Criar mensagem com upload de mídia se houver
  const handleCreateMessage = async () => {
    if (!userId) return;
    
    // Validação: título sempre obrigatório, conteúdo só obrigatório se não for áudio
    if (!formData.title.trim()) {
      showToast('Título é obrigatório', 'error');
      return;
    }
    
    // Conteúdo obrigatório exceto para áudio, PTV e vídeo (caption opcional)
    if (formData.message_type !== 'audio' && formData.message_type !== 'ptv' && formData.message_type !== 'video' && !formData.content.trim()) {
      showToast('Conteúdo é obrigatório', 'error');
      return;
    }
    // PTV exige vídeo anexado
    if (formData.message_type === 'ptv' && !attachmentFile && !formData.attachment_url) {
      showToast('Envie um vídeo para o Vídeo de Bolinha (PTV)', 'error');
      return;
    }
    // Vídeo normal exige vídeo anexado
    if (formData.message_type === 'video' && !attachmentFile && !formData.attachment_url) {
      showToast('Envie um vídeo para o tipo Vídeo', 'error');
      return;
    }

    // Só mostra loading se tiver arquivo para upload
    if (attachmentFile && mediaType) {
      setIsUploading(true);
      setUploadProgress(0);
      setUploadStatus('Criando mensagem...');
    }

    try {
      // 1. Criar mensagem primeiro (sem mídia ainda)
      if (attachmentFile && mediaType) {
        setUploadProgress(10);
      }
      // Mapeia "video" para text_with_attachment no backend; "ptv" permanece ptv
      const normalizedMessageType =
        formData.message_type === 'video' ? 'text_with_attachment' : formData.message_type;

      const createResponse = await fetch('/api/crm/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
        body: JSON.stringify({
          title: formData.title.trim(),
          content: formData.content.trim(),
          category: formData.category,
          has_attachment: !!attachmentFile || formData.message_type === 'ptv',
          attachment_with_caption: formData.attachment_with_caption,
          mention_all: formData.mention_all,
          message_type: normalizedMessageType,
          send_intelligent: !!formData.send_intelligent,
          attachment_url: null,
          ptv_delay: formData.message_type === 'ptv' ? (formData.ptv_delay ?? 1200) : undefined,
        }),
      });

      const createData = await createResponse.json();
      if (!createResponse.ok) {
        throw new Error(createData.error || 'Erro ao criar mensagem');
      }

      const messageId = createData.data?.id;
      
      if (attachmentFile && mediaType) {
        setUploadProgress(20);
      }

      // 2. Se tem arquivo, fazer upload e atualizar mensagem
      if (attachmentFile && mediaType && messageId) {
        try {
          // 2.1. Obter signed upload URL
          setUploadStatus('Preparando upload...');
          setUploadProgress(30);
          
          const uploadUrlResponse = await fetch('/api/messages/upload-media', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-User-Id': userId,
            },
            body: JSON.stringify({
              messageId,
              mediaType: mediaType,
              mime: attachmentFile.type,
              size: attachmentFile.size,
              originalName: attachmentFile.name,
            }),
          });

          const uploadUrlData = await uploadUrlResponse.json();
          if (!uploadUrlResponse.ok) {
            throw new Error(uploadUrlData.error || 'Erro ao gerar URL de upload');
          }

          const { bucket, path, token, signedUrl } = uploadUrlData.data;
          setUploadProgress(40);

          // 2.2. Fazer upload do arquivo (com progresso real para evitar gargalos na UI)
          setUploadStatus(`Enviando ${mediaType === 'image' ? 'imagem' : mediaType === 'video' ? 'vídeo' : 'áudio'}...`);
          if (signedUrl) {
            await uploadFileWithProgress(signedUrl, attachmentFile, {
              onProgress: (percent) => setUploadProgress(40 + Math.round(percent * 0.4)), // 40% -> 80%
            });
          } else if (token && path) {
            const { error: uploadError } = await supabaseClient.storage
              .from(bucket)
              .uploadToSignedUrl(path, token, attachmentFile);
            if (uploadError) throw new Error(`Erro no upload: ${uploadError.message}`);
          } else {
            throw new Error('URL de upload não fornecida');
          }

          setUploadProgress(80);
          setUploadStatus('Finalizando...');

          // 2.3. Atualizar mensagem com URL da mídia
          const updateResponse = await fetch('/api/messages/update-media-url', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-User-Id': userId,
            },
            body: JSON.stringify({
              messageId,
              bucket,
              path,
              mime: attachmentFile.type,
              size: attachmentFile.size,
              mediaType,
            }),
          });

          const updateData = await updateResponse.json();
          if (!updateResponse.ok) {
            throw new Error(updateData.error || 'Erro ao atualizar mensagem com mídia');
          }

          // 2.4. Se for envio inteligente e o anexo for vídeo, importa para o store de treinamento
          if (formData.send_intelligent && mediaType === 'video') {
            try {
              setUploadStatus('Armazenando vídeo no treinamento da LLM...');
              const importRes = await fetch('/api/ai/training/import-message-media', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-User-Id': userId,
                },
                body: JSON.stringify({ messageId }),
              });
              const importData = await importRes.json();
              if (!importRes.ok) {
                throw new Error(importData.error || 'Erro ao armazenar vídeo no treinamento');
              }
            } catch (importErr: any) {
              console.error('Erro ao importar vídeo para treinamento:', importErr);
              // Não falha a criação da mensagem; apenas informa
              showToast(
                `Mensagem criada, mas falhou ao armazenar vídeo no treinamento: ${importErr.message}`,
                'error'
              );
            }
          }

          setUploadProgress(100);
        } catch (mediaError: any) {
          console.error('Erro ao fazer upload de mídia:', mediaError);
          showToast(`Erro ao fazer upload de mídia: ${mediaError.message}`, 'error');
          setIsUploading(false);
          setUploadProgress(0);
          setUploadStatus('');
          // Não retorna aqui - a mensagem já foi criada, apenas sem mídia
          return;
        }
      }

      // Sucesso
      if (attachmentFile && mediaType) {
        setUploadProgress(100);
        setUploadStatus('Concluído!');
      }
      
      setShowCreateModal(false);
      setFormData({ 
        title: '', 
        content: '', 
        category: 'Boas vindas', 
        has_attachment: false,
        attachment_with_caption: false,
        mention_all: false,
        message_type: 'text_only',
        attachment_url: null,
        send_intelligent: false,
        ptv_delay: 1200,
      });
      handleRemoveFile();
      await loadMessages();
      showToast('Mensagem criada com sucesso!', 'success');
    } catch (error: any) {
      console.error('Erro ao criar mensagem:', error);
      showToast(error.message || 'Erro ao criar mensagem', 'error');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setUploadStatus('');
    }
  };

  // Editar mensagem com upload de mídia se houver
  const handleEditMessage = async () => {
    if (!userId || !editingMessage) return;
    
    // Validação: título sempre obrigatório, conteúdo só obrigatório se não for áudio
    if (!formData.title.trim()) {
      showToast('Título é obrigatório', 'error');
      return;
    }
    
    // Conteúdo obrigatório exceto para áudio, PTV e vídeo
    if (formData.message_type !== 'audio' && formData.message_type !== 'ptv' && formData.message_type !== 'video' && !formData.content.trim()) {
      showToast('Conteúdo é obrigatório', 'error');
      return;
    }

    // Só mostra loading se tiver arquivo novo para upload
    if (attachmentFile && mediaType) {
      setIsUploading(true);
      setUploadProgress(0);
      setUploadStatus('Atualizando mensagem...');
    }

    try {
      // 1. Atualizar mensagem primeiro (sem mídia nova ainda)
      if (attachmentFile && mediaType) {
        setUploadProgress(10);
      }
      const updateResponse = await fetch(`/api/crm/messages/${editingMessage.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
        body: JSON.stringify({
          title: formData.title.trim(),
          content: formData.content.trim(),
          category: formData.category,
          has_attachment: formData.has_attachment || !!attachmentFile,
          attachment_with_caption: formData.attachment_with_caption,
          mention_all: formData.mention_all,
          message_type: formData.message_type,
          ptv_delay: formData.message_type === 'ptv' ? (formData.ptv_delay ?? 1200) : undefined,
        }),
      });

      const updateData = await updateResponse.json();
      if (!updateResponse.ok) {
        throw new Error(updateData.error || 'Erro ao atualizar mensagem');
      }

      if (attachmentFile && mediaType) {
        setUploadProgress(20);
      }

      // 2. Se tem arquivo novo, fazer upload e atualizar mensagem
      if (attachmentFile && mediaType) {
        try {
          // 2.1. Obter signed upload URL
          setUploadStatus('Preparando upload...');
          setUploadProgress(30);
          
          const uploadUrlResponse = await fetch('/api/messages/upload-media', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-User-Id': userId,
            },
            body: JSON.stringify({
              messageId: editingMessage.id,
              mediaType: mediaType,
              mime: attachmentFile.type,
              size: attachmentFile.size,
              originalName: attachmentFile.name,
            }),
          });

          const uploadUrlData = await uploadUrlResponse.json();
          if (!uploadUrlResponse.ok) {
            throw new Error(uploadUrlData.error || 'Erro ao gerar URL de upload');
          }

          const { bucket, path, token, signedUrl } = uploadUrlData.data;
          setUploadProgress(40);

          // 2.2. Fazer upload do arquivo (com progresso real)
          setUploadStatus(`Enviando ${mediaType === 'image' ? 'imagem' : mediaType === 'video' ? 'vídeo' : 'áudio'}...`);
          if (signedUrl) {
            await uploadFileWithProgress(signedUrl, attachmentFile, {
              onProgress: (percent) => setUploadProgress(40 + Math.round(percent * 0.4)),
            });
          } else if (token && path) {
            const { error: uploadError } = await supabaseClient.storage
              .from(bucket)
              .uploadToSignedUrl(path, token, attachmentFile);
            if (uploadError) throw new Error(`Erro no upload: ${uploadError.message}`);
          } else {
            throw new Error('URL de upload não fornecida');
          }

          setUploadProgress(80);
          setUploadStatus('Finalizando...');

          // 2.3. Atualizar mensagem com URL da mídia
          const updateMediaResponse = await fetch('/api/messages/update-media-url', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-User-Id': userId,
            },
            body: JSON.stringify({
              messageId: editingMessage.id,
              bucket,
              path,
              mime: attachmentFile.type,
              size: attachmentFile.size,
              mediaType,
            }),
          });

          const updateMediaData = await updateMediaResponse.json();
          if (!updateMediaResponse.ok) {
            throw new Error(updateMediaData.error || 'Erro ao atualizar mensagem com mídia');
          }

          setUploadProgress(100);
        } catch (mediaError: any) {
          console.error('Erro ao fazer upload de mídia:', mediaError);
          showToast(`Erro ao fazer upload de mídia: ${mediaError.message}`, 'error');
          setIsUploading(false);
          setUploadProgress(0);
          setUploadStatus('');
          // Não retorna aqui - a mensagem já foi atualizada, apenas sem mídia nova
          return;
        }
      }

      // Sucesso
      if (attachmentFile && mediaType) {
        setUploadProgress(100);
        setUploadStatus('Concluído!');
      }
      
      setEditingMessage(null);
      setShowCreateModal(false);
      setFormData({ 
        title: '', 
        content: '', 
        category: 'Boas vindas', 
        has_attachment: false,
        attachment_with_caption: false,
        mention_all: false,
        message_type: 'text_only',
        attachment_url: null,
        send_intelligent: false,
        ptv_delay: 1200,
      });
      handleRemoveFile();
      await loadMessages();
      showToast('Mensagem atualizada com sucesso!', 'success');
    } catch (error: any) {
      console.error('Erro ao atualizar mensagem:', error);
      showToast(error.message || 'Erro ao atualizar mensagem', 'error');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setUploadStatus('');
    }
  };

  // Deletar mensagem
  const handleDeleteMessage = async (messageId: string) => {
    if (!userId) return;
    if (!confirm('Tem certeza que deseja deletar esta mensagem?')) return;

    try {
      const response = await fetch(`/api/crm/messages/${messageId}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId },
      });

      if (response.ok) {
        await loadMessages();
        setOpenMenuId(null);
        showToast('Mensagem deletada com sucesso!', 'success');
      } else {
        const data = await response.json();
        showToast(`Erro: ${data.error || 'Erro ao deletar mensagem'}`, 'error');
      }
    } catch (error) {
      console.error('Erro ao deletar mensagem:', error);
      showToast('Erro ao deletar mensagem', 'error');
    }
  };

  // Abrir modal de edição
  const handleOpenEdit = async (message: Message) => {
    setEditingMessage(message);
    
    // Determina o tipo de mensagem baseado na mídia existente
    let messageType = message.message_type || 'text_only';
    if (message.message_type === 'ptv') {
      messageType = 'ptv';
    } else if (message.has_attachment && message.attachment_type) {
      if (message.attachment_type === 'audio') {
        messageType = 'audio';
      } else {
        messageType = 'text_with_attachment';
      }
    }
    
    setFormData({
      title: message.title,
      content: message.content,
      category: message.category,
      has_attachment: message.has_attachment,
      attachment_with_caption: String(message.attachment_with_caption) === 'true',
      mention_all: String(message.mention_all) === 'true',
      message_type: messageType,
      attachment_url: message.attachment_url,
      send_intelligent: !!message.send_intelligent,
      ptv_delay: typeof message.ptv_delay === 'number' && message.ptv_delay >= 0 ? message.ptv_delay : 1200,
    });

    // Se a mensagem tem mídia, carregar para preview
    if (message.has_attachment && message.attachment_url && message.attachment_type) {
      setMediaPreviewUrl(message.attachment_url);
      setMediaType(message.attachment_type as 'image' | 'video' | 'audio');
      // Não define attachmentFile - é mídia existente do banco
      setAttachmentFile(null);
    } else {
      // Limpa preview se não tem mídia
      if (mediaPreviewUrl && mediaPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(mediaPreviewUrl);
      }
      setMediaPreviewUrl(null);
      setMediaType(null);
      setAttachmentFile(null);
    }

    setShowCreateModal(true);
    setOpenMenuId(null);
  };

  // Formata data
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  // Formata data e hora
  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Pausar agendamento
  const handlePauseSchedule = async (scheduleId: string) => {
    if (!userId) return;

    try {
      const response = await fetch(`/api/crm/activations/schedules/${scheduleId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
        body: JSON.stringify({ status: 'paused' }), // Usa 'paused' para pausar
      });

      const data = await response.json();
      if (response.ok) {
        await loadSchedules();
        showToast('Agendamento pausado com sucesso', 'success');
      } else {
        showToast(`Erro: ${data.error || 'Erro ao pausar agendamento'}`, 'error');
      }
    } catch (error) {
      console.error('Erro ao pausar agendamento:', error);
      showToast('Erro ao pausar agendamento', 'error');
    }
  };

  // Retomar agendamento
  const handleResumeSchedule = async (scheduleId: string) => {
    if (!userId) return;

    try {
      const response = await fetch(`/api/crm/activations/schedules/${scheduleId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
        body: JSON.stringify({ status: 'scheduled' }),
      });

      const data = await response.json();
      if (response.ok) {
        await loadSchedules();
        showToast('Agendamento retomado com sucesso', 'success');
      } else {
        showToast(`Erro: ${data.error || 'Erro ao retomar agendamento'}`, 'error');
      }
    } catch (error) {
      console.error('Erro ao retomar agendamento:', error);
      showToast('Erro ao retomar agendamento', 'error');
    }
  };

  // Ver detalhes do agendamento (pode ser um grupo de schedules do mesmo disparo)
  const [selectedSchedule, setSelectedSchedule] = useState<any | null>(null);
  const [selectedScheduleGroup, setSelectedScheduleGroup] = useState<any[]>([]);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  const handleViewDetails = (scheduleOrGroup: any | { schedules: any[] }) => {
    const group = Array.isArray(scheduleOrGroup?.schedules) ? scheduleOrGroup.schedules : [scheduleOrGroup];
    const first = group[0];
    if (!first) return;
    setSelectedSchedule(first);
    setSelectedScheduleGroup(group);
    setShowDetailsModal(true);
  };

  const handlePauseScheduleGroup = async (scheduleIds: string[]) => {
    if (!userId) return;
    for (const id of scheduleIds) {
      try {
        await fetch(`/api/crm/activations/schedules/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
          body: JSON.stringify({ status: 'paused' }),
        });
      } catch (e) {
        console.error('Erro ao pausar agendamento:', e);
      }
    }
    showToast('Disparo pausado.', 'success');
    loadSchedules();
  };

  const handleResumeScheduleGroup = async (scheduleIds: string[]) => {
    if (!userId) return;
    for (const id of scheduleIds) {
      try {
        await fetch(`/api/crm/activations/schedules/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
          body: JSON.stringify({ status: 'scheduled' }),
        });
      } catch (e) {
        console.error('Erro ao retomar agendamento:', e);
      }
    }
    showToast('Disparo retomado.', 'success');
    loadSchedules();
  };

  const handleDeleteScheduleGroup = async (scheduleIds: string[]) => {
    if (!userId) return;
    const ok = window.confirm(
      `Excluir este disparo para ${scheduleIds.length} grupo(s)? Todos os agendamentos serão removidos.`
    );
    if (!ok) return;
    for (const id of scheduleIds) {
      try {
        await fetch(`/api/crm/activations/schedules/${id}`, {
          method: 'DELETE',
          headers: { 'X-User-Id': userId },
        });
      } catch (e) {
        console.error('Erro ao excluir agendamento:', e);
      }
    }
    showToast('Disparo excluído.', 'success');
    loadSchedules();
  };

  const handleEditMessageFromSchedule = async (messageId: string) => {
    // Buscar a mensagem e abrir o modal de edição
    const message = messages.find(m => m.id === messageId);
    if (message) {
      setEditingMessage(message);
      
      // Determina o tipo de mensagem baseado na mídia existente
      let messageType = message.message_type || 'text_only';
      if (message.has_attachment && message.attachment_type) {
        if (message.attachment_type === 'audio') {
          messageType = 'audio';
        } else {
          messageType = 'text_with_attachment';
        }
      }
      
      // Preencher o form com os dados da mensagem
      const msg = message as Message;
      setFormData({
        title: message.title,
        content: message.content,
        category: message.category,
        has_attachment: message.has_attachment,
        attachment_with_caption: message.attachment_with_caption || false,
        mention_all: message.mention_all || false,
        message_type: messageType,
        attachment_url: message.attachment_url,
        send_intelligent: !!message.send_intelligent,
        ptv_delay: typeof msg.ptv_delay === 'number' && msg.ptv_delay >= 0 ? msg.ptv_delay : 1200,
      });

      // Se a mensagem tem mídia, carregar para preview
      if (message.has_attachment && message.attachment_url && message.attachment_type) {
        setMediaPreviewUrl(message.attachment_url);
        setMediaType(message.attachment_type as 'image' | 'video' | 'audio');
        setAttachmentFile(null); // É mídia existente, não arquivo novo
      } else {
        // Limpa preview se não tem mídia
        if (mediaPreviewUrl && mediaPreviewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(mediaPreviewUrl);
        }
        setMediaPreviewUrl(null);
        setMediaType(null);
        setAttachmentFile(null);
      }

      setShowCreateModal(true);
    } else {
      showToast('Mensagem não encontrada', 'error');
    }
  };

  // Excluir agendamento
  const handleDeleteSchedule = async (scheduleId: string) => {
    if (!userId) return;

    try {
      const response = await fetch(`/api/crm/activations/schedules/${scheduleId}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId },
      });

      const data = await response.json();
      if (response.ok) {
        await loadSchedules();
        showToast('Agendamento excluído com sucesso', 'success');
      } else {
        showToast(`Erro: ${data.error || 'Erro ao excluir agendamento'}`, 'error');
      }
    } catch (error) {
      console.error('Erro ao excluir agendamento:', error);
      showToast('Erro ao excluir agendamento', 'error');
    }
  };

  if (checking || !userId) {
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
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#8CD95515] rounded-lg">
            <Activity className="w-6 h-6 text-[#8CD955]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Mensagem</h1>
            <p className="text-gray-600">Gerencie suas mensagens personalizadas</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setActiveTab('messages')}
              className={`flex-1 px-6 py-4 font-medium transition-colors ${
                activeTab === 'messages'
                  ? 'text-[#8CD955] border-b-2 border-[#8CD955] bg-[#8CD955]/5'
                  : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              Mensagens
            </button>
            <button
              onClick={() => setActiveTab('schedules')}
              className={`flex-1 px-6 py-4 font-medium transition-colors ${
                activeTab === 'schedules'
                  ? 'text-[#8CD955] border-b-2 border-[#8CD955] bg-[#8CD955]/5'
                  : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              Agendamento
            </button>
          </div>
        </div>

        {/* Conteúdo das Tabs */}
        {activeTab === 'messages' && (
          <>
            {/* Barra de ações e pesquisa */}
            <div className="bg-gray-100 rounded-xl shadow-md p-4 border border-gray-200">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            {/* Selecionar todos e pesquisa */}
            <div className="flex items-center gap-4 flex-1 w-full md:w-auto">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filteredMessages.length > 0 && selectedMessages.size === filteredMessages.length}
                  onChange={handleSelectAll}
                  className="w-5 h-5 text-[#8CD955] rounded focus:ring-[#8CD955]"
                />
                <span className="text-sm text-gray-700 font-medium">Selecionar todos</span>
              </label>

              <div className="relative flex-1 md:flex-initial md:w-80">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 w-5 h-5" />
                <input
                  type="text"
                  placeholder="Pesquisar mensagens..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-gray-100 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-gray-900 placeholder:text-gray-500"
                />
              </div>
            </div>

            {/* Contador e botão nova mensagem */}
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600 font-medium">
                {filteredMessages.length} mensagem{filteredMessages.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={() => {
                  setEditingMessage(null);
                  setFormData({ 
                    title: '', 
                    content: '', 
                    category: 'Boas vindas', 
                    has_attachment: false,
                    attachment_with_caption: false,
                    mention_all: false,
                    message_type: 'text_only',
                    attachment_url: null,
                    send_intelligent: false,
                    ptv_delay: 1200,
                  });
                  handleRemoveFile();
                  setShowCreateModal(true);
                }}
                className="flex items-center gap-2 bg-[#8CD955] hover:bg-[#7BC84A] text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-md"
              >
                <Plus className="w-5 h-5" />
                Nova mensagem
              </button>
            </div>
          </div>
        </div>

        {/* Lista de mensagens */}
        <div className="bg-gray-100 rounded-xl shadow-md border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-12 text-center">
              <div className="inline-block w-8 h-8 border-4 border-[#8CD955] border-t-transparent rounded-full animate-spin"></div>
              <p className="mt-4 text-gray-600">Carregando mensagens...</p>
            </div>
          ) : filteredMessages.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-500">Nenhuma mensagem encontrada</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredMessages.map((message) => (
                <div
                  key={message.id}
                  className="p-4 bg-white hover:bg-[#8CD95515] transition-colors relative group border-b border-gray-200 last:border-b-0"
                >
                  <div className="flex items-start gap-4">
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={selectedMessages.has(message.id)}
                      onChange={() => handleSelectMessage(message.id)}
                      className="w-5 h-5 text-[#8CD955] rounded focus:ring-[#8CD955] mt-1 flex-shrink-0"
                    />

                    {/* Ícone de favorito */}
                    <button
                      onClick={() => handleToggleFavorite(message.id, message.is_favorite)}
                      className="flex-shrink-0 mt-1"
                    >
                      {message.is_favorite ? (
                        <Heart className="w-5 h-5 text-red-500 fill-red-500" />
                      ) : (
                        <Heart className="w-5 h-5 text-gray-400 hover:text-red-500" />
                      )}
                    </button>

                    {/* Conteúdo */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-gray-800 mb-1">{message.title}</h3>
                          <div className="flex items-center gap-4 text-sm text-gray-600 flex-wrap">
                            <span className="flex items-center gap-1">
                              <span className="font-medium">Criação:</span>
                              {formatDate(message.created_at)}
                            </span>
                            {message.category && (
                              <span className="px-2 py-1 bg-[#8CD95515] text-[#6AB83D] rounded text-xs font-medium">
                                {message.category}
                              </span>
                            )}
                            {isAdmin && message.profiles && (
                              <span className="text-gray-500">
                                Por: {message.profiles.full_name || message.profiles.email}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Menu de opções */}
                        <div className="relative flex-shrink-0">
                          <button
                            onClick={() => setOpenMenuId(openMenuId === message.id ? null : message.id)}
                            className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                          >
                            <MoreVertical className="w-5 h-5 text-gray-600" />
                          </button>

                          {openMenuId === message.id && (
                            <>
                              <div
                                className="fixed inset-0 z-10"
                                onClick={() => setOpenMenuId(null)}
                              />
                              <div className="absolute right-0 top-full mt-2 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20 min-w-[150px]">
                                <button
                                  onClick={() => {
                                    setMessageToSend(message);
                                    setShowSendModal(true);
                                    setOpenMenuId(null);
                                  }}
                                  className="w-full px-4 py-2 text-left text-sm text-[#8CD955] hover:bg-[#8CD95515] flex items-center gap-2 font-medium"
                                >
                                  <Send className="w-4 h-4" />
                                  Enviar mensagem
                                </button>
                                <button
                                  onClick={() => handleOpenEdit(message)}
                                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                                >
                                  <Edit2 className="w-4 h-4" />
                                  Editar
                                </button>
                                <button
                                  onClick={() => handleDeleteMessage(message.id)}
                                  className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                                >
                                  <Trash2 className="w-4 h-4" />
                                  Deletar
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Preview */}
                      {message.preview && (
                        <div className="mt-2">
                          <span className="text-xs font-medium text-gray-500">Preview:</span>
                          <p className="text-sm text-gray-700 mt-1">{message.preview}</p>
                        </div>
                      )}

                      {/* Anexo */}
                      {message.has_attachment && (
                        <div className="mt-2 flex items-center gap-1 text-gray-500">
                          <Paperclip className="w-4 h-4" />
                          <span className="text-xs">Anexo</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal de criar/editar mensagem */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl my-8">
              {/* Header */}
              <div className="flex justify-between items-center p-6 border-b border-gray-200">
                <h2 className="text-xl font-bold text-gray-800">
                  {editingMessage ? 'Editar mensagem' : 'Nova mensagem'}
                </h2>
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    setEditingMessage(null);
                    setFormData({ 
                      title: '', 
                      content: '', 
                      category: 'Boas vindas', 
                      has_attachment: false,
                      attachment_with_caption: false,
                      mention_all: false,
                      message_type: 'text_only',
                      attachment_url: null,
                      send_intelligent: false,
                      ptv_delay: 1200,
                    });
                    handleRemoveFile();
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex flex-col lg:flex-row h-[calc(100vh-200px)] max-h-[800px]">
                {/* Coluna Esquerda - Formulário */}
                <div className="flex-1 p-6 overflow-y-auto border-r border-gray-200">
                  {/* 1. Informações gerais */}
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold text-gray-800 mb-4">1. Informações gerais</h3>
                    <div className="space-y-4">
                      {/* Título */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Título da mensagem: <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={formData.title}
                          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700"
                          placeholder="Ex: asas"
                          required
                        />
                      </div>

                      {/* Mensagem */}
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <label className="text-sm font-medium text-gray-700">
                            Mensagem:{' '}
                            {!(formData.message_type === 'audio' || formData.message_type === 'ptv' || formData.message_type === 'video') && (
                              <span className="text-red-500">*</span>
                            )}
                          </label>
                          <div className="w-3 h-3 bg-[#8CD955] rounded-full"></div>
                        </div>
                        <textarea
                          value={formData.content}
                          onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-gray-700 min-h-[150px] resize-y"
                          placeholder={
                            formData.message_type === 'ptv' || formData.message_type === 'video'
                              ? 'Legenda opcional (deixe em branco para enviar só o vídeo)'
                              : 'Digite o conteúdo da mensagem...'
                          }
                          required={!(formData.message_type === 'audio' || formData.message_type === 'ptv' || formData.message_type === 'video')}
                        />
                      </div>

                      {/* Mencionar todos */}
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-gray-700 cursor-pointer">
                          Mencionar todos os usuários do grupo
                        </label>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!formData.mention_all}
                            onChange={(e) => setFormData({ ...formData, mention_all: e.target.checked })}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#8CD955]/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#8CD955]"></div>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* 2. Configurações */}
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-4">2. Configurações</h3>
                    
                    <div className="space-y-4">
                      {/* Tipo de mensagem */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Selecione o tipo de mensagem que deseja enviar:
                        </label>
                        <select
                          value={formData.message_type}
                          onChange={(e) => setFormData({ ...formData, message_type: e.target.value })}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700"
                        >
                          <option value="text_only">Somente textos e/ou anexos</option>
                          <option value="text_with_attachment">Texto com anexo</option>
                          <option value="video">Vídeo</option>
                          <option value="ptv">Vídeo de Bolinha (PTV)</option>
                          <option value="audio">Áudio</option>
                        </select>
                      </div>

                      {/* Envio Inteligente (oculto por enquanto) */}
                      {!HIDE_SMART_SEND && (
                        <div className="flex items-center justify-between">
                          <div className="flex flex-col">
                            <label className="text-sm font-medium text-gray-700 cursor-pointer">
                              Envio Inteligente
                            </label>
                          </div>
                          <label
                            className={`relative inline-flex items-center cursor-pointer ${
                              formData.message_type !== 'video' ? 'opacity-50 pointer-events-none' : ''
                            }`}
                            title={
                              formData.message_type !== 'video'
                                ? 'Disponível apenas para o tipo Vídeo'
                                : undefined
                            }
                          >
                            <input
                              type="checkbox"
                              checked={!!formData.send_intelligent}
                              onChange={(e) => setFormData({ ...formData, send_intelligent: e.target.checked })}
                              className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#8CD955]/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#8CD955]"></div>
                          </label>
                        </div>
                      )}

                      {/* Info box para áudio */}
                      {formData.message_type === 'audio' && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
                          <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                          <p className="text-sm text-blue-800">
                            Se desejar enviar um áudio como se fosse gravado, você precisa baixar o áudio original em formato .ogg do WhatsApp e anexá-lo abaixo
                          </p>
                        </div>
                      )}

                      {/* Upload de arquivo */}
                      {(formData.message_type === 'text_with_attachment' || formData.message_type === 'video' || formData.message_type === 'ptv' || formData.message_type === 'audio') && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            {formData.message_type === 'audio' ? 'Áudio' : formData.message_type === 'ptv' ? 'Vídeo (PTV)' : formData.message_type === 'video' ? 'Vídeo' : 'Anexo'}
                          </label>
                          
                          {!attachmentFile && !mediaPreviewUrl ? (
                            <div
                              onClick={() => fileInputRef.current?.click()}
                              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-[#8CD955] hover:bg-[#8CD95515] transition-colors"
                            >
                              <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                              <p className="text-sm text-gray-600 mb-1">
                                Arraste o arquivo ou clique aqui
                              </p>
                              <p className="text-xs text-gray-500">
                                {formData.message_type === 'audio' 
                                  ? 'Formatos: MP3, WAV, OGG' 
                                  : formData.message_type === 'video' || formData.message_type === 'ptv'
                                    ? 'Formatos: MP4, WEBM, OGG'
                                  : 'Imagens: JPEG, JPG, PNG, GIF, WEBP | Vídeos: MP4, WEBM, OGG | Áudios: MP3, WAV, OGG'}
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {/* Preview da mídia */}
                              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                                {mediaType === 'image' && mediaPreviewUrl && (
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                      <span className="text-sm font-medium text-gray-700">Imagem</span>
                                      <button
                                        onClick={handleRemoveFile}
                                        className="text-red-600 hover:text-red-700 text-sm"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                    <img
                                      src={mediaPreviewUrl}
                                      alt="Preview"
                                      className="max-w-full max-h-48 rounded-lg object-contain mx-auto"
                                      onError={(e) => {
                                        // Se a URL expirou, tenta gerar nova signed URL
                                        console.error('Erro ao carregar imagem, URL pode ter expirado');
                                      }}
                                    />
                                    {attachmentFile && (
                                      <p className="text-xs text-gray-500 text-center">
                                        {attachmentFile.name} ({(attachmentFile.size / (1024 * 1024)).toFixed(2)} MB)
                                      </p>
                                    )}
                                    {!attachmentFile && editingMessage?.attachment_size && (
                                      <p className="text-xs text-gray-500 text-center">
                                        Mídia existente ({(editingMessage.attachment_size / (1024 * 1024)).toFixed(2)} MB)
                                      </p>
                                    )}
                                  </div>
                                )}
                                
                                {mediaType === 'video' && mediaPreviewUrl && (
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                      <span className="text-sm font-medium text-gray-700">Vídeo</span>
                                      <button
                                        onClick={handleRemoveFile}
                                        className="text-red-600 hover:text-red-700 text-sm"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                    <video
                                      src={mediaPreviewUrl}
                                      controls
                                      className="max-w-full max-h-48 rounded-lg mx-auto"
                                      onError={(e) => {
                                        console.error('Erro ao carregar vídeo, URL pode ter expirado');
                                      }}
                                    />
                                    {attachmentFile && (
                                      <p className="text-xs text-gray-500 text-center">
                                        {attachmentFile.name} ({(attachmentFile.size / (1024 * 1024)).toFixed(2)} MB)
                                      </p>
                                    )}
                                    {!attachmentFile && editingMessage?.attachment_size && (
                                      <p className="text-xs text-gray-500 text-center">
                                        Mídia existente ({(editingMessage.attachment_size / (1024 * 1024)).toFixed(2)} MB)
                                      </p>
                                    )}
                                  </div>
                                )}
                                
                                {mediaType === 'audio' && mediaPreviewUrl && (
                                  <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                      <span className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                        <Music className="w-4 h-4" />
                                        Áudio
                                      </span>
                                      <button
                                        onClick={handleRemoveFile}
                                        className="text-red-600 hover:text-red-700 text-sm flex items-center gap-1"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                        Remover
                                      </button>
                                    </div>
                                    <div className="bg-white rounded-lg p-4 border border-gray-200">
                                      <audio 
                                        src={mediaPreviewUrl} 
                                        controls 
                                        className="w-full"
                                        preload="metadata"
                                        onError={(e) => {
                                          console.error('Erro ao carregar áudio, URL pode ter expirado');
                                        }}
                                      />
                                    </div>
                                    {attachmentFile && (
                                      <div className="text-center">
                                        <p className="text-xs text-gray-500">
                                          <span className="font-medium">{attachmentFile.name}</span>
                                          <span className="ml-2">({(attachmentFile.size / (1024 * 1024)).toFixed(2)} MB)</span>
                                        </p>
                                      </div>
                                    )}
                                    {!attachmentFile && editingMessage?.attachment_size && (
                                      <div className="text-center">
                                        <p className="text-xs text-gray-500">
                                          <span className="font-medium">Mídia existente</span>
                                          <span className="ml-2">({(editingMessage.attachment_size / (1024 * 1024)).toFixed(2)} MB)</span>
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                              
                              <button
                                onClick={() => fileInputRef.current?.click()}
                                className="w-full px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                              >
                                Trocar arquivo
                              </button>
                            </div>
                          )}
                          
                          <input
                            ref={fileInputRef}
                            type="file"
                            onChange={handleFileChange}
                            accept={
                              formData.message_type === 'audio'
                                ? 'audio/*'
                                : formData.message_type === 'video'
                                  ? 'video/*'
                                  : 'image/*,video/*,audio/*'
                            }
                            className="hidden"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Coluna Direita - Preview do Celular */}
                <div className="lg:w-96 p-6 bg-gray-50 overflow-y-auto">
                  <div className="w-full max-w-[280px] mx-auto">
                    <h3 className="text-sm font-semibold text-gray-700 mb-4">3. Preview:</h3>
                    {/* Mockup do celular */}
                    <div className="bg-gray-900 rounded-[2.5rem] p-2 shadow-2xl">
                      <div className="bg-white rounded-[2rem] overflow-hidden">
                        {/* Status bar */}
                        <div className="bg-gray-900 text-white text-xs px-4 py-1 flex justify-between items-center">
                          <span>18:39</span>
                          <div className="flex items-center gap-1">
                            <div className="w-4 h-2 border border-white rounded-sm">
                              <div className="w-full h-full bg-white"></div>
                            </div>
                            <span className="text-[10px]">100%</span>
                          </div>
                        </div>

                        {/* Header do chat */}
                        <div className="bg-[#8CD955] text-white px-4 py-3 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <ArrowLeft className="w-5 h-5 cursor-pointer" />
                            <div className="w-10 h-10 bg-[#7BC84A] rounded-full flex items-center justify-center font-bold">
                              DC
                            </div>
                            <div>
                              <div className="font-semibold">Zaploto Cliente</div>
                              <div className="text-xs text-emerald-100">online</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <Video className="w-5 h-5 cursor-pointer" />
                            <Phone className="w-5 h-5 cursor-pointer" />
                            <MoreVerticalIcon className="w-5 h-5 cursor-pointer" />
                          </div>
                        </div>

                        {/* Área de mensagens */}
                        <div className="bg-gray-100 h-[400px] p-4 overflow-y-auto">
                          <div className="text-center text-xs text-gray-500 mb-4">HOJE</div>
                          
                          {/* Mensagem */}
                          <div className="flex justify-end mb-2">
                            {mediaPreviewUrl && (mediaType === 'image' || mediaType === 'video') ? (
                              <div className="bg-[#8CD955] text-white rounded-lg max-w-[80%] shadow-sm overflow-hidden">
                                {/* Preview de mídia no celular - preenche completamente sem espaço verde */}
                                {mediaType === 'image' && (
                                  <img
                                    src={mediaPreviewUrl}
                                    alt="Preview"
                                    className="w-full h-auto block"
                                    style={{ 
                                      maxHeight: '400px', 
                                      objectFit: 'cover',
                                      display: 'block',
                                      borderRadius: formData.content ? '0.5rem 0.5rem 0 0' : '0.5rem'
                                    }}
                                  />
                                )}
                                
                                {mediaType === 'video' && (
                                  <video
                                    src={mediaPreviewUrl}
                                    controls
                                    className="w-full h-auto block"
                                    style={{ 
                                      maxHeight: '400px',
                                      borderRadius: formData.content ? '0.5rem 0.5rem 0 0' : '0.5rem'
                                    }}
                                  />
                                )}
                                
                                {/* Texto abaixo da mídia se houver */}
                                {formData.content && (
                                  <div className="px-3 pt-2">
                                    <p className="text-sm whitespace-pre-wrap break-words">
                                      {formData.content}
                                    </p>
                                  </div>
                                )}
                                
                                {/* Timestamp e checkmarks */}
                                <div className="flex items-center justify-end gap-1 px-3 pb-2">
                                  <span className="text-[10px] text-emerald-100">18:39</span>
                                  <CheckCheck className="w-3 h-3 text-emerald-100" />
                                </div>
                              </div>
                            ) : (
                              <div className="bg-[#8CD955] text-white rounded-lg px-3 py-2 max-w-[80%] shadow-sm">
                                {mediaPreviewUrl && mediaType === 'audio' && (
                                  <div className="mb-2">
                                    <audio src={mediaPreviewUrl} controls className="w-full" />
                                  </div>
                                )}
                                
                                <p className="text-sm whitespace-pre-wrap break-words">
                                  {formData.content || 'Digite sua mensagem...'}
                                </p>
                                <div className="flex items-center justify-end gap-1 mt-1">
                                  <span className="text-[10px] text-emerald-100">18:39</span>
                                  <CheckCheck className="w-3 h-3 text-emerald-100" />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Input bar */}
                        <div className="bg-white border-t border-gray-200 px-3 py-2 flex items-center gap-2">
                          <Smile className="w-5 h-5 text-gray-400 cursor-pointer" />
                          <input
                            type="text"
                            placeholder="Mensagem"
                            className="flex-1 text-sm py-2 px-3 bg-gray-100 rounded-full focus:outline-none"
                            disabled
                          />
                          <Paperclip className="w-5 h-5 text-gray-400 cursor-pointer" />
                          <Camera className="w-5 h-5 text-gray-400 cursor-pointer" />
                          <div className="w-8 h-8 bg-[#8CD955] rounded-full flex items-center justify-center cursor-pointer">
                            <Mic className="w-4 h-4 text-white" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer com botões */}
              <div className="flex flex-col gap-3 p-6 border-t border-gray-200">
                {/* Barra de progresso de upload */}
                {isUploading && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 font-medium">{uploadStatus || 'Enviando...'}</span>
                      <span className="text-gray-500">{uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-[#8CD955] h-2 rounded-full transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}
                
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => {
                      if (isUploading) return; // Não permite cancelar durante upload
                      setShowCreateModal(false);
                      setEditingMessage(null);
                      setFormData({ 
                        title: '', 
                        content: '', 
                        category: 'Boas vindas', 
                        has_attachment: false,
                        attachment_with_caption: false,
                        mention_all: false,
                        message_type: 'text_only',
                        attachment_url: null,
                        send_intelligent: false,
                        ptv_delay: 1200,
                      });
                      handleRemoveFile();
                    }}
                    disabled={isUploading}
                    className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={editingMessage ? handleEditMessage : handleCreateMessage}
                    disabled={
                      isUploading || 
                      !formData.title.trim() || 
                      (formData.message_type !== 'audio' && formData.message_type !== 'ptv' && formData.message_type !== 'video' && !formData.content.trim())
                    }
                    className="px-6 py-2 bg-[#8CD955] hover:bg-[#7BC84A] text-white rounded-lg font-medium transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 min-w-[120px] justify-center"
                  >
                    {isUploading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Enviando...</span>
                      </>
                    ) : (
                      'Salvar'
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal de envio de ativação */}
        {showSendModal && messageToSend && (
          <SendActivationsModal
            isOpen={showSendModal}
            onClose={() => {
              setShowSendModal(false);
              setMessageToSend(null);
            }}
            messageId={messageToSend.id}
            messageTitle={messageToSend.title}
            userId={userId}
          />
        )}
          </>
        )}

        {/* Tab Agendamento */}
        {activeTab === 'schedules' && (
          <div className="space-y-4">
            {/* Barra de pesquisa e filtros */}
            <div className="bg-white rounded-xl shadow-md border border-gray-200 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="text"
                    placeholder="Buscar por título"
                    value={scheduleSearchTitle}
                    onChange={(e) => setScheduleSearchTitle(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-gray-100 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-900 placeholder:text-gray-500 text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600 whitespace-nowrap">Criação:</span>
                  <input
                    type="date"
                    value={scheduleFilterCreatedFrom}
                    onChange={(e) => setScheduleFilterCreatedFrom(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] text-gray-700 text-sm"
                  />
                  <span className="text-gray-400">até</span>
                  <input
                    type="date"
                    value={scheduleFilterCreatedTo}
                    onChange={(e) => setScheduleFilterCreatedTo(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] text-gray-700 text-sm"
                  />
                </div>
                <select
                  value={scheduleFilterStatus}
                  onChange={(e) => setScheduleFilterStatus(e.target.value as 'all' | 'sent' | 'failed')}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] text-gray-700 text-sm"
                >
                  <option value="all">Todos os status</option>
                  <option value="sent">Executado</option>
                  <option value="failed">Falhou</option>
                </select>
                <select
                  value={scheduleFilterType}
                  onChange={(e) => setScheduleFilterType(e.target.value as 'all' | 'one_time' | 'recurring')}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] text-gray-700 text-sm"
                >
                  <option value="all">Todos os tipos</option>
                  <option value="one_time">Pontual</option>
                  <option value="recurring">Recorrente</option>
                </select>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={handleRecalculateRecurring}
                    disabled={recalculatingRecurring}
                    className="px-3 py-2 rounded-lg bg-amber-100 text-amber-800 border border-amber-300 text-sm font-medium hover:bg-amber-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                    title="Recalcula a data/hora da próxima execução de todos os agendamentos recorrentes (corrige dados antigos)"
                  >
                    {recalculatingRecurring ? (
                      <>
                        <span className="inline-block w-4 h-4 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
                        Recalculando...
                      </>
                    ) : (
                      <>Recalcular próximas execuções</>
                    )}
                  </button>
                )}
              </div>
            </div>

            {loadingSchedules ? (
              <div className="bg-gray-100 rounded-xl shadow-md border border-gray-200 p-12 text-center">
                <div className="inline-block w-8 h-8 border-4 border-[#8CD955] border-t-transparent rounded-full animate-spin"></div>
                <p className="mt-4 text-gray-600">Carregando agendamentos...</p>
              </div>
            ) : filteredSchedules.length === 0 ? (
              <div className="bg-gray-100 rounded-xl shadow-md border border-gray-200 p-12 text-center">
                <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">
                  {schedules.length === 0
                    ? 'Nenhum agendamento encontrado'
                    : 'Nenhum agendamento corresponde aos filtros'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {scheduleGroups.map(({ key, schedules: groupSchedules }) => {
                  const schedule = groupSchedules[0];
                  const message = schedule.messages;
                  const isRecurring = schedule.schedule_type === 'recurring';
                  const isActive = groupSchedules.some((s) => s.status === 'scheduled' || s.status === 'processing');
                  const isSent = groupSchedules.every((s) => s.status === 'sent');
                  const isFailed = groupSchedules.some((s) => s.status === 'failed');
                  const isPaused = groupSchedules.some((s) => s.status === 'paused');
                  const isCanceled = groupSchedules.every((s) => s.status === 'canceled');
                  const groupNames = groupSchedules.map((s) => s.group_subject || s.group_id);
                  const scheduleIds = groupSchedules.map((s) => s.id);

                  return (
                    <div
                      key={key}
                      className="bg-white rounded-xl shadow-md border border-gray-200 p-4 sm:p-6 hover:shadow-lg transition-shadow min-w-0 flex flex-col"
                    >
                      {/* Header do Card */}
                      <div className="flex flex-wrap items-start justify-between gap-2 mb-3 sm:mb-4">
                        <div className="flex flex-wrap items-center gap-2">
                          {isRecurring ? (
                            <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium flex items-center gap-1 shrink-0">
                              <Clock className="w-3 h-3" />
                              Recorrente
                            </span>
                          ) : (
                            <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium flex items-center gap-1 shrink-0">
                              <Calendar className="w-3 h-3" />
                              Pontual
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {isActive && (
                            <span className="px-2 py-1 bg-[#8CD955] text-white rounded-full text-xs font-medium">
                              • ATIVO
                            </span>
                          )}
                          {isSent && (
                            <span className="px-2 py-1 bg-gray-500 text-white rounded-full text-xs font-medium">
                              Executado
                            </span>
                          )}
                          {isFailed && (
                            <span className="px-2 py-1 bg-red-500 text-white rounded-full text-xs font-medium" title={schedule.last_error ? `Erro: ${schedule.last_error}` : undefined}>
                              Falhou
                            </span>
                          )}
                          {isPaused && (
                            <span className="px-2 py-1 bg-orange-500 text-white rounded-full text-xs font-medium">
                              Pausado
                            </span>
                          )}
                          {isCanceled && (
                            <span className="px-2 py-1 bg-gray-500 text-white rounded-full text-xs font-medium">
                              Cancelado
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Título */}
                      <div className="mb-3 sm:mb-4 min-w-0">
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-1">TÍTULO</p>
                        <p className="text-gray-800 font-medium break-words">{message?.title || 'Sem título'}</p>
                      </div>

                      {/* Grupos deste disparo */}
                      <div className="mb-3 sm:mb-4 min-w-0">
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-1">GRUPOS ({groupSchedules.length})</p>
                        <div className="flex flex-wrap gap-1">
                          {groupNames.slice(0, 5).map((name, i) => (
                            <span key={i} className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">
                              {name}
                            </span>
                          ))}
                          {groupNames.length > 5 && (
                            <span className="px-2 py-0.5 bg-gray-200 text-gray-600 rounded text-xs">
                              +{groupNames.length - 5}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Informações de Execução */}
                      <div className="mb-3 sm:mb-4 space-y-2 min-w-0">
                        {isRecurring ? (
                          <>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600">
                              <Calendar className="w-4 h-4 shrink-0" />
                              <span className="font-medium shrink-0">PRÓXIMA EXECUÇÃO:</span>
                              <span className="break-words">{schedule.next_run_utc ? formatDateTime(schedule.next_run_utc) : 'Não agendado'}</span>
                            </div>
                            {schedule.recurring_days && schedule.recurring_days.length > 0 && schedule.recurring_time && (
                              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mt-2 min-w-0">
                                <p className="text-xs font-semibold text-orange-800 mb-1">AGENDAMENTO RECORRENTE</p>
                                <p className="text-xs text-orange-700 break-words">
                                  {schedule.recurring_days.map((day: string) => {
                                    const dayMap: Record<string, string> = {
                                      monday: 'Seg',
                                      tuesday: 'Ter',
                                      wednesday: 'Qua',
                                      thursday: 'Qui',
                                      friday: 'Sex',
                                      saturday: 'Sáb',
                                      sunday: 'Dom',
                                    };
                                    return dayMap[day] || day;
                                  }).join(', ')} às {schedule.recurring_time}
                                </p>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-600">
                            <Calendar className="w-4 h-4 shrink-0" />
                            <span className="font-medium shrink-0">DATA PROGRAMADA:</span>
                            <span className="break-words">{schedule.scheduled_at_utc ? formatDateTime(schedule.scheduled_at_utc) : 'Não agendado'}</span>
                          </div>
                        )}
                      </div>

                      {/* Ações */}
                      <div className="flex flex-col sm:flex-row flex-wrap gap-2 mt-auto pt-2">
                        {isActive && (
                          <button
                            onClick={() => handlePauseScheduleGroup(scheduleIds)}
                            className="w-full sm:flex-1 min-w-0 px-3 py-2 sm:px-4 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 text-sm"
                          >
                            <Pause className="w-4 h-4 shrink-0" />
                            Pausar
                          </button>
                        )}
                        {isPaused && (
                          <button
                            onClick={() => handleResumeScheduleGroup(scheduleIds)}
                            className="w-full sm:flex-1 min-w-0 px-3 py-2 sm:px-4 bg-[#8CD955] hover:bg-[#7BC84A] text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 text-sm"
                          >
                            <Play className="w-4 h-4 shrink-0" />
                            Retomar
                          </button>
                        )}
                        <button
                          onClick={() => handleViewDetails({ schedules: groupSchedules })}
                          className="w-full sm:flex-1 min-w-0 px-3 py-2 sm:px-4 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 text-sm"
                        >
                          <Eye className="w-4 h-4 shrink-0" />
                          Ver detalhes
                        </button>
                        <button
                          onClick={() => handleDeleteScheduleGroup(scheduleIds)}
                          className="w-full sm:flex-1 min-w-0 px-3 py-2 sm:px-4 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 text-sm"
                        >
                          <Trash className="w-4 h-4 shrink-0" />
                          Excluir
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal de Detalhes do Agendamento */}
      {selectedSchedule && (
        <ScheduleDetailsModal
          isOpen={showDetailsModal}
          onClose={() => {
            setShowDetailsModal(false);
            setSelectedSchedule(null);
            setSelectedScheduleGroup([]);
          }}
          schedule={selectedSchedule}
          groupSchedules={selectedScheduleGroup}
          userId={userId}
          onUpdate={loadSchedules}
          onEditMessage={handleEditMessageFromSchedule}
        />
      )}
    </Layout>
  );
};

export default ActivationsPage;
