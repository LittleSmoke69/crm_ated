'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Layout from '@/components/Layout';
import { supabase } from '@/lib/supabase';
import {
  MessageSquare,
  Send,
  Check,
  CheckCheck,
  Clock,
  Search,
  Users,
  Phone,
  MoreVertical,
  Smile,
  Paperclip,
  Mic,
  FileText,
  Bot,
  CheckCircle2,
  XCircle,
  Filter,
  Inbox,
  MessageCircle,
  AlertCircle,
  RefreshCw,
  Database,
} from 'lucide-react';

interface Message {
  id: string;
  text: string;
  direction: 'in' | 'out';
  status: string;
  timestamp: number;
  created_at: string;
  from_me: boolean;
  media_type?: string;
  media_url?: string;
  caption?: string;
  sender_jid?: string;
}

interface Conversation {
  id: string;
  remote_jid: string;
  title: string;
  last_message_preview: string;
  last_message_at: string;
  unread_count: number;
  is_group: boolean;
  user_id?: string;
}

interface ChannelEvolution {
  type: 'evolution';
  id: string;
  instance_name: string;
  status: string;
}

interface ChannelWhatsAppOfficial {
  type: 'whatsapp_official';
  id: string;
  name: string;
  phone_number_id: string;
}

type Channel = ChannelEvolution | ChannelWhatsAppOfficial;

type ConversationFilter = 'all' | 'mine' | 'unassigned';

type UserStatus = 'super_admin' | 'admin' | 'suporte' | string | null;

export default function ChatPage() {
  const { checking, userId } = useRequireAuth();
  const [userStatus, setUserStatus] = useState<UserStatus>(null);
  const [channels, setChannels] = useState<{ evolution: ChannelEvolution[]; whatsapp_official: ChannelWhatsAppOfficial[] }>({
    evolution: [],
    whatsapp_official: [],
  });
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [conversationFilter, setConversationFilter] = useState<ConversationFilter>('all');
  const [showResolveMenu, setShowResolveMenu] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const authHeaders = (): Record<string, string> => (userId ? { 'X-User-Id': userId } : {});
  const canSelectChannel =
    userStatus === 'super_admin' || userStatus === 'admin' || userStatus === 'suporte';

  const handleSignOut = async () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
    }
    window.location.href = '/login';
  };

  // Carregar perfil (status) para controle de exibição do canal
  useEffect(() => {
    if (!userId) return;
    const loadProfile = async () => {
      try {
        const res = await fetch('/api/user/profile', { headers: authHeaders() });
        const data = await res.json();
        if (data.success && data.data?.status) setUserStatus(data.data.status);
      } catch {
        setUserStatus(null);
      }
    };
    loadProfile();
  }, [userId]);

  // Carregar canais (Evolution + WhatsApp Oficial)
  useEffect(() => {
    if (!userId) return;

    const loadChannels = async () => {
      try {
        const response = await fetch('/api/chat/channels', { headers: authHeaders() });
        const result = await response.json();
        if (result.success && result.data) {
          setChannels({
            evolution: result.data.evolution || [],
            whatsapp_official: result.data.whatsapp_official || [],
          });
          const evo = result.data.evolution || [];
          const wa = result.data.whatsapp_official || [];
          if (!selectedChannel && (evo.length > 0 || wa.length > 0)) {
            if (evo.length > 0) setSelectedChannel(evo[0]);
            else setSelectedChannel(wa[0]);
          }
        }
      } catch (error) {
        console.error('Erro ao carregar canais:', error);
      }
    };

    loadChannels();
  }, [userId]);

  // Carrega conversas do banco (uma por número de telefone; conversas existentes são continuadas, não criadas novas)
  const loadConversationsFromApi = useCallback(
    async (keepSelectionIfPresent = false) => {
      if (!selectedChannel) return;
      setLoading(true);
      try {
        const params =
          selectedChannel.type === 'evolution'
            ? `instance_id=${selectedChannel.id}`
            : `whatsapp_config_id=${selectedChannel.id}`;
        const response = await fetch(`/api/chat/conversations?${params}`, { headers: authHeaders() });
        const result = await response.json();
        if (result.success) {
          const list = result.data || [];
          setConversations(list);
          // Ao atualizar lista, manter conversa selecionada só se ainda existir no banco
          if (keepSelectionIfPresent) {
            setSelectedConversationId((prev) =>
              prev && list.some((c: Conversation) => c.id === prev) ? prev : ''
            );
          }
        }
      } catch (error) {
        console.error('Erro ao carregar conversas:', error);
      } finally {
        setLoading(false);
      }
    },
    [selectedChannel]
  );

  // Carregar conversas do banco quando o canal mudar
  useEffect(() => {
    if (!selectedChannel) return;
    loadConversationsFromApi(false);
  }, [selectedChannel, loadConversationsFromApi]);

  // Carregar mensagens quando conversa mudar
  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      return;
    }

    const loadMessages = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/chat/messages?conversation_id=${selectedConversationId}&limit=100`, {
          headers: authHeaders(),
        });
        const result = await response.json();
        if (result.success) {
          setMessages(result.data || []);
        }
      } catch (error) {
        console.error('Erro ao carregar mensagens:', error);
      } finally {
        setLoading(false);
      }
    };

    loadMessages();
  }, [selectedConversationId]);

  // Scroll para última mensagem
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Supabase Realtime para mensagens
  useEffect(() => {
    if (!selectedConversationId) return;

    const channel = supabase
      .channel(`chat_messages_${selectedConversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_messages',
          filter: `conversation_id=eq.${selectedConversationId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setMessages((prev) => [...prev, payload.new as Message]);
          } else if (payload.eventType === 'UPDATE') {
            setMessages((prev) =>
              prev.map((msg) => (msg.id === payload.new.id ? (payload.new as Message) : msg))
            );
          } else if (payload.eventType === 'DELETE') {
            setMessages((prev) => prev.filter((msg) => msg.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedConversationId]);

  // Pedir permissão de notificação para suporte/admin/super_admin (nova conversa)
  useEffect(() => {
    const canNotify =
      userStatus === 'super_admin' || userStatus === 'admin' || userStatus === 'suporte';
    if (!canNotify || typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, [userStatus]);

  // Supabase Realtime para conversas (Evolution por instance_id, Oficial por whatsapp_config_id)
  useEffect(() => {
    if (!selectedChannel) return;

    const filterCol = selectedChannel.type === 'evolution' ? 'instance_id' : 'whatsapp_config_id';
    const filterVal = selectedChannel.id;
    const canNotify =
      userStatus === 'super_admin' || userStatus === 'admin' || userStatus === 'suporte';

    const channel = supabase
      .channel(`chat_conversations_${selectedChannel.type}_${selectedChannel.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_conversations',
          filter: `${filterCol}=eq.${filterVal}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const newConv = payload.new as Conversation;
            const isNew = payload.eventType === 'INSERT';

            setConversations((prev) => {
              const existing = prev.findIndex((c) => c.id === newConv.id);
              if (existing >= 0) {
                const updated = [...prev];
                updated[existing] = newConv;
                return updated.sort((a, b) =>
                  new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
                );
              }
              return [newConv, ...prev];
            });

            // Notificar usuários de suporte quando chegar nova conversa (aba em segundo plano)
            if (isNew && canNotify && typeof window !== 'undefined' && 'Notification' in window) {
              const convTitle = newConv.title || 'Nova conversa';
              const preview = (newConv.last_message_preview || '').slice(0, 60);
              if (document.visibilityState === 'hidden' && Notification.permission === 'granted') {
                try {
                  new Notification('Nova conversa no Chat — Zaploto', {
                    body: preview ? `${convTitle}: ${preview}${preview.length >= 60 ? '...' : ''}` : convTitle,
                    icon: '/favicon.ico',
                  });
                } catch (_) {}
              }
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedChannel, userStatus]);

  const handleSendMessage = async () => {
    if (!messageText.trim() || !selectedConversationId || !selectedChannel || sending) return;

    const conversation = conversations.find((c) => c.id === selectedConversationId);
    if (!conversation) return;

    setSending(true);
    try {
      if (selectedChannel.type === 'evolution') {
        const response = await fetch('/api/chat/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            instance_id: selectedChannel.id,
            remoteJid: conversation.remote_jid,
            type: 'text',
            text: messageText,
          }),
        });
        const result = await response.json();
        if (result.success) {
          setMessageText('');
          if (textareaRef.current) textareaRef.current.style.height = 'auto';
        } else {
          alert(result.error || result.message || 'Erro ao enviar mensagem');
        }
      } else {
        const to = (conversation.remote_jid || '').replace(/@s\.whatsapp\.net$/, '').replace(/\D/g, '') || conversation.remote_jid;
        const response = await fetch('/api/chat/whatsapp-official/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            config_id: selectedChannel.id,
            to,
            type: 'text',
            text: messageText,
          }),
        });
        const result = await response.json();
        if (result.success) {
          setMessageText('');
          if (textareaRef.current) textareaRef.current.style.height = 'auto';
        } else {
          alert(result.error || result.message || 'Erro ao enviar mensagem');
        }
      }
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error);
      alert('Erro ao enviar mensagem');
    } finally {
      setSending(false);
    }
  };

  const formatTime = (timestamp: number | string) => {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp * 1000);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'Agora';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  };

  const formatMessageTime = (timestamp: number | string) => {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp * 1000);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    if (isToday) {
      return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
    
    return date.toLocaleDateString('pt-BR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'sent':
        return <Check className="w-4 h-4" />;
      case 'delivered':
        return <CheckCheck className="w-4 h-4" />;
      case 'read':
        return <CheckCheck className="w-4 h-4" style={{ color: '#8CD955' }} />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getConversationColor = (title: string) => {
    const colors = [
      '#8CD955',
      '#7BC84A',
      '#6AB83D',
      '#A8E677',
      '#5AA832',
      '#4C9628',
      '#3E841E',
      '#2F7214',
    ];
    const index = title.charCodeAt(0) % colors.length;
    return colors[index];
  };

  // Filtrar conversas (null-safe: title e last_message_preview podem ser null)
  const filteredConversations = conversations.filter((conv) => {
    const term = (searchTerm || '').trim().toLowerCase();
    const matchesSearch =
      !term ||
      (conv.title || '').toLowerCase().includes(term) ||
      (conv.last_message_preview || '').toLowerCase().includes(term);

    if (!matchesSearch) return false;

    switch (conversationFilter) {
      case 'mine':
        return conv.user_id === userId;
      case 'unassigned':
        return !conv.user_id || conv.user_id === null;
      case 'all':
      default:
        return true;
    }
  });

  const mineCount = conversations.filter((c) => c.user_id === userId).length;
  const unassignedCount = conversations.filter((c) => !c.user_id || c.user_id === null).length;
  const allCount = conversations.length;

  if (checking) {
    return (
      <Layout onSignOut={handleSignOut}>
        <div className="flex items-center justify-center h-screen bg-[var(--background)]">
          <div className="text-[var(--muted-foreground)]">Carregando...</div>
        </div>
      </Layout>
    );
  }

  const selectedConversation = conversations.find((c) => c.id === selectedConversationId);

  return (
    <Layout onSignOut={handleSignOut}>
      <div className="flex h-[calc(100vh-80px)] bg-gray-50 dark:bg-[#1e1e1e]">
        {/* Painel Esquerdo - Navegação e Instâncias */}
        <div className="w-64 bg-white dark:bg-[#2a2a2a] border-r border-gray-200 dark:border-[#404040] flex flex-col">
          <div className="p-4 border-b border-gray-200 dark:border-[#404040]">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Zaploto Chat</h2>
            <div className="space-y-2">
              <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-[#333] text-gray-700 dark:text-gray-200">
                <Inbox className="w-5 h-5" />
                <span className="text-sm font-medium">Minha Caixa</span>
              </button>
              <div className="space-y-1">
                <div className="px-3 py-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Conversas</div>
                <button
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-white"
                  style={{ backgroundColor: '#8CD955' }}
                >
                  <MessageCircle className="w-5 h-5" />
                  <span className="text-sm font-medium">Todas as conversas</span>
                </button>
                <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-[#333] text-gray-700 dark:text-gray-200">
                  <AlertCircle className="w-5 h-5" />
                  <span className="text-sm">Menções</span>
                </button>
                <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-[#333] text-gray-700 dark:text-gray-200">
                  <Clock className="w-5 h-5" />
                  <span className="text-sm">Por responder</span>
                </button>
              </div>
            </div>
          </div>

          {/* Canal: apenas super_admin e admin podem trocar; suporte e outros só usam o canal atual */}
          {canSelectChannel ? (
            <div className="p-4 border-b border-gray-200 dark:border-[#404040]">
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
                Canal
              </label>
              <select
                value={selectedChannel ? `${selectedChannel.type}:${selectedChannel.id}` : ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) {
                    setSelectedChannel(null);
                    setSelectedConversationId('');
                    return;
                  }
                  const [type, id] = v.split(':');
                  if (type === 'evolution') {
                    const ch = channels.evolution.find((c) => c.id === id);
                    if (ch) setSelectedChannel(ch);
                  } else {
                    const ch = channels.whatsapp_official.find((c) => c.id === id);
                    if (ch) setSelectedChannel(ch);
                  }
                  setSelectedConversationId('');
                }}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-[#404040] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100"
                style={{ borderColor: '#8CD955' }}
              >
                <option value="">Selecione um canal</option>
                {channels.evolution.length > 0 && (
                  <optgroup label="Evolution">
                    {channels.evolution.map((ch) => (
                      <option key={ch.id} value={`evolution:${ch.id}`}>
                        {ch.instance_name} ({ch.status})
                      </option>
                    ))}
                  </optgroup>
                )}
                {channels.whatsapp_official.length > 0 && (
                  <optgroup label="WhatsApp Oficial">
                    {channels.whatsapp_official.map((ch) => (
                      <option key={ch.id} value={`whatsapp_official:${ch.id}`}>
                        {ch.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          ) : selectedChannel ? (
            <div className="p-4 border-b border-gray-200 dark:border-[#404040]">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Chat</div>
              <div className="text-sm text-gray-700 dark:text-gray-200">
                {selectedChannel.type === 'evolution' ? selectedChannel.instance_name : selectedChannel.name}
              </div>
            </div>
          ) : null}

          <div className="flex-1 overflow-y-auto p-4">
            {!selectedChannel ? (
              <div className="text-center text-gray-500 dark:text-gray-400 text-sm mt-8">
                {canSelectChannel ? 'Selecione um canal' : 'Carregando...'}
              </div>
            ) : !canSelectChannel ? null : (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {selectedChannel.type === 'evolution'
                  ? selectedChannel.instance_name
                  : selectedChannel.name}
              </div>
            )}
          </div>
        </div>

        {/* Painel Central - Lista de Conversas (sempre do banco; uma conversa por número, continuada) */}
        <div className="w-80 bg-white dark:bg-[#2a2a2a] border-r border-gray-200 dark:border-[#404040] flex flex-col">
          {/* Header: conversas do banco + atualizar */}
          <div className="p-4 border-b border-gray-200 dark:border-[#404040]">
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <Database className="w-4 h-4 text-[#8CD955]" />
                Conversas do banco
              </span>
              <button
                type="button"
                onClick={() => loadConversationsFromApi(true)}
                disabled={!selectedChannel || loading}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#8CD955] hover:bg-[#8CD95515] dark:hover:bg-[#8CD95520] rounded-lg border border-[#8CD955] disabled:opacity-50 disabled:cursor-not-allowed"
                title="Recarregar conversas salvas no banco (por número de telefone)"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                Atualizar
              </button>
            </div>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 text-sm bg-gray-100 dark:bg-[#333] border border-gray-200 dark:border-[#404040] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400"
              />
            </div>

            {/* Abas de Filtro */}
            <div className="flex items-center gap-1 border-b border-gray-200 dark:border-[#404040] -mx-4 px-4">
              <button
                onClick={() => setConversationFilter('mine')}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  conversationFilter === 'mine'
                    ? 'border-[#8CD955] text-[#8CD955]'
                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                }`}
              >
                Minhas ({mineCount})
              </button>
              <button
                onClick={() => setConversationFilter('unassigned')}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  conversationFilter === 'unassigned'
                    ? 'border-[#8CD955] text-[#8CD955]'
                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                }`}
              >
                Não atribuídas ({unassignedCount})
              </button>
              <button
                onClick={() => setConversationFilter('all')}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  conversationFilter === 'all'
                    ? 'border-[#8CD955] text-[#8CD955]'
                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                }`}
              >
                Todas ({allCount})
              </button>
            </div>
          </div>

          {/* Lista de Conversas */}
          <div className="flex-1 overflow-y-auto">
            {loading && !selectedChannel ? (
              <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">Carregando...</div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
                {selectedChannel ? (
                  <>
                    Nenhuma conversa no banco para este canal.
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      Cada número tem uma única conversa; ao chegar nova mensagem ela é continuada, não criada outra.
                    </p>
                    {(userStatus === 'super_admin' || userStatus === 'admin' || userStatus === 'suporte') && (
                      <p className="mt-1 text-xs">Novas mensagens no WhatsApp aparecerão aqui e você será notificado.</p>
                    )}
                  </>
                ) : (
                  'Selecione um canal'
                )}
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const initials = getInitials(conv.title || '');
                const bgColor = getConversationColor(conv.title || '');
                const isSelected = selectedConversationId === conv.id;

                return (
                  <div
                    key={conv.id}
                    onClick={() => setSelectedConversationId(conv.id)}
                    className={`p-3 border-b border-gray-100 dark:border-[#404040] cursor-pointer hover:bg-gray-50 dark:hover:bg-[#333] transition-colors ${
                      isSelected ? 'bg-[#8CD95515] dark:bg-[#8CD95520] border-l-4 border-l-[#8CD955]' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                        style={{ backgroundColor: bgColor }}
                      >
                        {conv.is_group ? (
                          <Users className="w-5 h-5" />
                        ) : (
                          <span>{initials}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{conv.title || 'Sem nome'}</h3>
                          <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 ml-2">
                            {formatTime(conv.last_message_at)}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600 dark:text-gray-400 truncate mb-1">{conv.last_message_preview || '—'}</p>
                        <div className="flex items-center justify-end">
                          {conv.unread_count > 0 && (
                            <span
                              className="text-xs font-bold text-white rounded-full px-2 py-0.5 flex-shrink-0"
                              style={{ backgroundColor: '#8CD955' }}
                            >
                              {conv.unread_count}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Painel Direito - Chat Ativo */}
        <div className="flex-1 flex flex-col bg-gray-50 dark:bg-[#1e1e1e]">
          {selectedConversationId && selectedConversation ? (
            <>
              {/* Header da Conversa */}
              <div className="bg-white dark:bg-[#2a2a2a] border-b border-gray-200 dark:border-[#404040] px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold"
                    style={{ backgroundColor: getConversationColor(selectedConversation.title) }}
                  >
                    {selectedConversation.is_group ? (
                      <Users className="w-5 h-5" />
                    ) : (
                      <span>{getInitials(selectedConversation.title)}</span>
                    )}
                  </div>
                  <div>
                    <h2 className="font-semibold text-gray-900 dark:text-gray-100">{selectedConversation.title}</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{selectedConversation.remote_jid}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <button
                      onClick={() => setShowResolveMenu(!showResolveMenu)}
                      className="px-4 py-2 text-sm font-medium text-white rounded-lg flex items-center gap-2"
                      style={{ backgroundColor: '#8CD955' }}
                    >
                      Resolver
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                  </div>
                  <button className="p-2 hover:bg-gray-100 dark:hover:bg-[#333] rounded-lg text-gray-600 dark:text-gray-300">
                    <MoreVertical className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Mensagens */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {loading ? (
                  <div className="text-center text-gray-500 dark:text-gray-400 text-sm">Carregando mensagens...</div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-gray-500 dark:text-gray-400 text-sm mt-8">Nenhuma mensagem ainda</div>
                ) : (
                  messages.map((msg, index) => {
                    const showDate =
                      index === 0 ||
                      new Date(msg.timestamp * 1000).toDateString() !==
                        new Date(messages[index - 1].timestamp * 1000).toDateString();

                    return (
                      <React.Fragment key={msg.id}>
                        {showDate && (
                          <div className="text-center text-xs text-gray-500 dark:text-gray-400 my-4">
                            {new Date(msg.timestamp * 1000).toLocaleDateString('pt-BR', {
                              day: 'numeric',
                              month: 'short',
                            })}
                          </div>
                        )}
                        <div className={`flex ${msg.from_me ? 'justify-end' : 'justify-start'}`}>
                          {!msg.from_me && (
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold mr-2 flex-shrink-0"
                              style={{
                                backgroundColor: getConversationColor(msg.sender_jid || selectedConversation.title),
                              }}
                            >
                              {getInitials(msg.sender_jid || selectedConversation.title)}
                            </div>
                          )}
                          <div
                            className={`max-w-md px-4 py-2 rounded-lg ${
                              msg.from_me
                                ? 'bg-[#8CD955] text-white rounded-br-none'
                                : 'bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 rounded-bl-none border border-gray-200 dark:border-[#404040]'
                            }`}
                          >
                            {msg.text && (
                              <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>
                            )}
                            {msg.caption && (
                              <p className={`text-sm mt-1 ${msg.from_me ? 'text-white/90' : 'text-gray-600 dark:text-gray-300'}`}>
                                {msg.caption}
                              </p>
                            )}
                            <div
                              className={`flex items-center justify-end gap-1 mt-1 ${
                                msg.from_me ? 'text-white/80' : 'text-gray-500 dark:text-gray-400'
                              }`}
                            >
                              <span className="text-xs">{formatMessageTime(msg.timestamp)}</span>
                              {msg.from_me && getStatusIcon(msg.status)}
                            </div>
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input de Mensagem */}
              <div className="bg-white dark:bg-[#2a2a2a] border-t border-gray-200 dark:border-[#404040] p-4">
                <div className="mb-2 flex items-center gap-2">
                  <button className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#333] rounded-lg">
                    Responder
                  </button>
                  <button className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#333] rounded-lg">
                    Nota Privada
                  </button>
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1 relative">
                    <textarea
                      ref={textareaRef}
                      value={messageText}
                      onChange={(e) => {
                        setMessageText(e.target.value);
                        if (textareaRef.current) {
                          textareaRef.current.style.height = 'auto';
                          textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      placeholder="Shift + Enter para nova linha. Comece com '/' para selecionar uma resposta pronta."
                      rows={1}
                      className="w-full px-4 py-2 text-sm border border-gray-300 dark:border-[#404040] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400 resize-none overflow-y-auto"
                      style={{ minHeight: '40px', maxHeight: '120px' }}
                      disabled={sending}
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <button className="p-2 hover:bg-gray-100 dark:hover:bg-[#333] rounded-lg text-gray-600 dark:text-gray-300">
                      <Smile className="w-5 h-5" />
                    </button>
                    <button className="p-2 hover:bg-gray-100 dark:hover:bg-[#333] rounded-lg text-gray-600 dark:text-gray-300">
                      <Paperclip className="w-5 h-5" />
                    </button>
                    <button className="p-2 hover:bg-gray-100 dark:hover:bg-[#333] rounded-lg text-gray-600 dark:text-gray-300">
                      <Mic className="w-5 h-5" />
                    </button>
                    <button className="p-2 hover:bg-gray-100 dark:hover:bg-[#333] rounded-lg text-gray-600 dark:text-gray-300">
                      <FileText className="w-5 h-5" />
                    </button>
                    <button className="p-2 hover:bg-gray-100 dark:hover:bg-[#333] rounded-lg text-gray-600 dark:text-gray-300">
                      <MessageSquare className="w-5 h-5" />
                    </button>
                    <button
                      className="px-4 py-2 text-sm font-medium text-white rounded-lg flex items-center gap-2"
                      style={{ backgroundColor: '#8CD955' }}
                    >
                      <Bot className="w-4 h-4" />
                      Assistente de IA
                    </button>
                    <button
                      onClick={handleSendMessage}
                      disabled={!messageText.trim() || sending}
                      className="px-4 py-2 text-sm font-medium text-white rounded-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ backgroundColor: '#8CD955' }}
                    >
                      <Send className="w-4 h-4" />
                      Enviar
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <MessageSquare className="w-16 h-16 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
                <p className="text-gray-600 dark:text-gray-400">Selecione uma conversa para começar</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
