'use client';

import React, { useState, useEffect, useRef } from 'react';
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

interface Instance {
  id: string;
  instance_name: string;
  status: string;
}

type ConversationFilter = 'all' | 'mine' | 'unassigned';

export default function ChatPage() {
  const { checking, userId } = useRequireAuth();
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>('');
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

  const handleSignOut = async () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
    }
    window.location.href = '/login';
  };

  // Carregar instâncias
  useEffect(() => {
    if (!userId) return;

    const loadInstances = async () => {
      try {
        const response = await fetch('/api/chat/instances');
        const result = await response.json();
        if (result.success) {
          setInstances(result.data || []);
          if (result.data && result.data.length > 0 && !selectedInstanceId) {
            setSelectedInstanceId(result.data[0].id);
          }
        }
      } catch (error) {
        console.error('Erro ao carregar instâncias:', error);
      }
    };

    loadInstances();
  }, [userId, selectedInstanceId]);

  // Carregar conversas quando instância mudar
  useEffect(() => {
    if (!selectedInstanceId) return;

    const loadConversations = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/chat/conversations?instance_id=${selectedInstanceId}`);
        const result = await response.json();
        if (result.success) {
          setConversations(result.data || []);
        }
      } catch (error) {
        console.error('Erro ao carregar conversas:', error);
      } finally {
        setLoading(false);
      }
    };

    loadConversations();
  }, [selectedInstanceId]);

  // Carregar mensagens quando conversa mudar
  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      return;
    }

    const loadMessages = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/chat/messages?conversation_id=${selectedConversationId}&limit=100`);
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

  // Supabase Realtime para conversas
  useEffect(() => {
    if (!selectedInstanceId) return;

    const channel = supabase
      .channel(`chat_conversations_${selectedInstanceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_conversations',
          filter: `instance_id=eq.${selectedInstanceId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            setConversations((prev) => {
              const existing = prev.findIndex((c) => c.id === payload.new.id);
              if (existing >= 0) {
                const updated = [...prev];
                updated[existing] = payload.new as Conversation;
                return updated.sort((a, b) =>
                  new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
                );
              }
              return [payload.new as Conversation, ...prev];
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedInstanceId]);

  const handleSendMessage = async () => {
    if (!messageText.trim() || !selectedConversationId || sending) return;

    const conversation = conversations.find((c) => c.id === selectedConversationId);
    if (!conversation) return;

    setSending(true);
    try {
      const response = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instance_id: selectedInstanceId,
          remoteJid: conversation.remote_jid,
          type: 'text',
          text: messageText,
        }),
      });

      const result = await response.json();
      if (result.success) {
        setMessageText('');
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
        }
      } else {
        alert(result.message || 'Erro ao enviar mensagem');
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

  // Filtrar conversas
  const filteredConversations = conversations.filter((conv) => {
    const matchesSearch =
      conv.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      conv.last_message_preview.toLowerCase().includes(searchTerm.toLowerCase());

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
        <div className="flex items-center justify-center h-screen">
          <div className="text-gray-500">Carregando...</div>
        </div>
      </Layout>
    );
  }

  const selectedConversation = conversations.find((c) => c.id === selectedConversationId);

  return (
    <Layout onSignOut={handleSignOut}>
      <div className="flex h-[calc(100vh-80px)] bg-gray-50">
        {/* Painel Esquerdo - Navegação e Instâncias */}
        <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Zaploto Chat</h2>
            <div className="space-y-2">
              <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 text-gray-700">
                <Inbox className="w-5 h-5" />
                <span className="text-sm font-medium">Minha Caixa</span>
              </button>
              <div className="space-y-1">
                <div className="px-3 py-1 text-xs font-semibold text-gray-500 uppercase">Conversas</div>
                <button
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-white"
                  style={{ backgroundColor: '#8CD955' }}
                >
                  <MessageCircle className="w-5 h-5" />
                  <span className="text-sm font-medium">Todas as conversas</span>
                </button>
                <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 text-gray-700">
                  <AlertCircle className="w-5 h-5" />
                  <span className="text-sm">Menções</span>
                </button>
                <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 text-gray-700">
                  <Clock className="w-5 h-5" />
                  <span className="text-sm">Por responder</span>
                </button>
              </div>
            </div>
          </div>

          <div className="p-4 border-b border-gray-200">
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">
              Instância WhatsApp
            </label>
            <select
              value={selectedInstanceId}
              onChange={(e) => {
                setSelectedInstanceId(e.target.value);
                setSelectedConversationId('');
              }}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
              style={{ borderColor: '#8CD955' }}
            >
              <option value="">Selecione uma instância</option>
              {instances.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.instance_name} ({inst.status})
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {!selectedInstanceId ? (
              <div className="text-center text-gray-500 text-sm mt-8">
                Selecione uma instância
              </div>
            ) : (
              <div className="text-xs text-gray-500">
                {instances.find((i) => i.id === selectedInstanceId)?.instance_name || 'Instância'}
              </div>
            )}
          </div>
        </div>

        {/* Painel Central - Lista de Conversas */}
        <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
          {/* Header com Busca */}
          <div className="p-4 border-b border-gray-200">
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
              />
            </div>

            {/* Abas de Filtro */}
            <div className="flex items-center gap-1 border-b border-gray-200 -mx-4 px-4">
              <button
                onClick={() => setConversationFilter('mine')}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  conversationFilter === 'mine'
                    ? 'border-[#8CD955] text-[#8CD955]'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                Minhas ({mineCount})
              </button>
              <button
                onClick={() => setConversationFilter('unassigned')}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  conversationFilter === 'unassigned'
                    ? 'border-[#8CD955] text-[#8CD955]'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                Não atribuídas ({unassignedCount})
              </button>
              <button
                onClick={() => setConversationFilter('all')}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  conversationFilter === 'all'
                    ? 'border-[#8CD955] text-[#8CD955]'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                Todas ({allCount})
              </button>
            </div>
          </div>

          {/* Lista de Conversas */}
          <div className="flex-1 overflow-y-auto">
            {loading && !selectedInstanceId ? (
              <div className="p-4 text-center text-gray-500 text-sm">Carregando...</div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-4 text-center text-gray-500 text-sm">
                {selectedInstanceId ? 'Nenhuma conversa encontrada' : 'Selecione uma instância'}
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const initials = getInitials(conv.title);
                const bgColor = getConversationColor(conv.title);
                const isSelected = selectedConversationId === conv.id;

                return (
                  <div
                    key={conv.id}
                    onClick={() => setSelectedConversationId(conv.id)}
                    className={`p-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${
                      isSelected ? 'bg-[#8CD95515] border-l-4 border-l-[#8CD955]' : ''
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
                          <h3 className="text-sm font-semibold text-gray-900 truncate">{conv.title}</h3>
                          <span className="text-xs text-gray-500 flex-shrink-0 ml-2">
                            {formatTime(conv.last_message_at)}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600 truncate mb-1">{conv.last_message_preview}</p>
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
        <div className="flex-1 flex flex-col bg-gray-50">
          {selectedConversationId && selectedConversation ? (
            <>
              {/* Header da Conversa */}
              <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
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
                    <h2 className="font-semibold text-gray-900">{selectedConversation.title}</h2>
                    <p className="text-xs text-gray-500">{selectedConversation.remote_jid}</p>
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
                  <button className="p-2 hover:bg-gray-100 rounded-lg">
                    <MoreVertical className="w-5 h-5 text-gray-600" />
                  </button>
                </div>
              </div>

              {/* Mensagens */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {loading ? (
                  <div className="text-center text-gray-500 text-sm">Carregando mensagens...</div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-gray-500 text-sm mt-8">Nenhuma mensagem ainda</div>
                ) : (
                  messages.map((msg, index) => {
                    const showDate =
                      index === 0 ||
                      new Date(msg.timestamp * 1000).toDateString() !==
                        new Date(messages[index - 1].timestamp * 1000).toDateString();

                    return (
                      <React.Fragment key={msg.id}>
                        {showDate && (
                          <div className="text-center text-xs text-gray-500 my-4">
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
                                : 'bg-white text-gray-900 rounded-bl-none border border-gray-200'
                            }`}
                          >
                            {msg.text && (
                              <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>
                            )}
                            {msg.caption && (
                              <p className={`text-sm mt-1 ${msg.from_me ? 'text-white/90' : 'text-gray-600'}`}>
                                {msg.caption}
                              </p>
                            )}
                            <div
                              className={`flex items-center justify-end gap-1 mt-1 ${
                                msg.from_me ? 'text-white/80' : 'text-gray-500'
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
              <div className="bg-white border-t border-gray-200 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <button className="px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">
                    Responder
                  </button>
                  <button className="px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">
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
                      className="w-full px-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] resize-none overflow-y-auto"
                      style={{ minHeight: '40px', maxHeight: '120px' }}
                      disabled={sending}
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <button className="p-2 hover:bg-gray-100 rounded-lg text-gray-600">
                      <Smile className="w-5 h-5" />
                    </button>
                    <button className="p-2 hover:bg-gray-100 rounded-lg text-gray-600">
                      <Paperclip className="w-5 h-5" />
                    </button>
                    <button className="p-2 hover:bg-gray-100 rounded-lg text-gray-600">
                      <Mic className="w-5 h-5" />
                    </button>
                    <button className="p-2 hover:bg-gray-100 rounded-lg text-gray-600">
                      <FileText className="w-5 h-5" />
                    </button>
                    <button className="p-2 hover:bg-gray-100 rounded-lg text-gray-600">
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
                <MessageSquare className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">Selecione uma conversa para começar</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
