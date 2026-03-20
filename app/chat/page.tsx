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
  MoreVertical,
  Smile,
  Paperclip,
  Mic,
  FileText,
  Image as ImageIcon,
  Bot,
  CheckCircle2,
  MessageCircle,
  AlertCircle,
  Loader2,
  X,
  UserPlus,
  UserCheck,
  ChevronUp,
  ChevronLeft,
  PanelLeft,
  PanelRightClose,
  PanelRightOpen,
  BookUser,
  Play,
  Pause,
  Square,
  Trash2,
  RefreshCw,
  Tag,
} from 'lucide-react';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Message {
  id: string;
  text: string | null;
  direction: 'in' | 'out';
  status: string;
  timestamp: number;
  created_at: string;
  from_me: boolean;
  media_type?: 'text' | 'image' | 'audio' | 'video' | 'document' | null;
  media_url?: string | null;
  caption?: string | null;
  sender_jid?: string | null;
}

interface Conversation {
  id: string;
  remote_jid: string;
  title: string;
  last_message_preview: string;
  last_message_at: string;
  last_customer_message_at?: string | null;
  unread_count: number;
  is_group: boolean;
  user_id?: string;
  whatsapp_config_id?: string | null;
  attendance_status?: 'pendente' | 'resolvido' | null;
  resolved_at?: string | null;
  assigned_at?: string | null;
  tags?: string[] | null;
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
type ActiveView = 'chat' | 'contacts';

interface ChatContact {
  id: string;
  name?: string | null;
  telefone: string;
  horario?: string | null;
}

// ─── EmojiPicker ───────────────────────────────────────────────────────────────

const EMOJI_CATEGORIES = [
  { label: '😀', emojis: ['😀','😂','🥰','😍','🤩','😎','🥳','😊','🙂','😉','😋','😜','🤣','😅','😆','🤔','😐','🙄','😏','😒','😳','🤯','😱','😨','😰','😥','😓','🤗','🤭','🫡','😇','🥺','😢','😭','😤','😠','😡','🤬','💀','💩','👻','👽','🤖','😺'] },
  { label: '❤️', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','💕','💞','💓','💗','💖','💘','💝','👍','👎','👊','✊','🤞','🤟','🤘','🤙','👋','✋','💪','🙏','👏','🤲','✌️','🤝'] },
  { label: '🎉', emojis: ['🎉','🎊','🎈','🎁','🎀','🏆','🥇','🎯','🎲','🎮','🎤','🎵','🎶','🔥','✨','⚡','💫','🌟','⭐','🌈','☀️','🌙','💥','🎆','🎇','✅','❌','⚠️','🔔','📢','📣','💬','📱','💻'] },
  { label: '🐶', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🦋','🦄','🌸','🌻','🌹','🍀','🌴','🌊'] },
  { label: '🍕', emojis: ['🍕','🍔','🌮','🌯','🍣','🍜','🍦','🍰','🎂','🍩','🍪','🧁','🍫','🍬','🍭','☕','🧃','🍺','🥂','🍷','🍸','🍹','🥤','🧋'] },
];

function EmojiPicker({ onSelect, onClose }: { onSelect: (emoji: string) => void; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 mb-2 w-72 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-xl shadow-xl z-30 overflow-hidden"
    >
      <div className="flex border-b border-gray-200 dark:border-[#404040]">
        {EMOJI_CATEGORIES.map((cat, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActiveTab(i)}
            className={`flex-1 py-2 text-base hover:bg-gray-100 dark:hover:bg-[#333] transition-colors ${activeTab === i ? 'bg-gray-100 dark:bg-[#333]' : ''}`}
          >
            {cat.label}
          </button>
        ))}
      </div>
      <div className="p-2 grid grid-cols-8 gap-0.5 max-h-48 overflow-y-auto">
        {EMOJI_CATEGORIES[activeTab].emojis.map((emoji, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(emoji)}
            className="text-xl p-1 rounded hover:bg-gray-100 dark:hover:bg-[#333] transition-colors"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── MediaModal ────────────────────────────────────────────────────────────────

function MediaModal({
  url,
  type,
  caption,
  onClose,
}: {
  url: string;
  type: 'image' | 'video';
  caption?: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90"
      onClick={onClose}
    >
      <button
        className="absolute top-4 right-4 text-white/80 hover:text-white bg-black/40 rounded-full p-1"
        onClick={onClose}
      >
        <X size={28} />
      </button>
      <div
        className="max-w-[90vw] max-h-[85vh] flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        {type === 'image' ? (
          <img
            src={url}
            alt={caption ?? 'imagem'}
            className="max-w-[90vw] max-h-[80vh] rounded-lg object-contain"
          />
        ) : (
          <video
            src={url}
            controls
            autoPlay
            className="max-w-[90vw] max-h-[80vh] rounded-lg"
          />
        )}
        {caption && (
          <p className="text-white/80 text-sm text-center max-w-lg">{caption}</p>
        )}
      </div>
    </div>
  );
}

// ─── AudioMessagePlayer (play, duração, waveform) ─────────────────────────────

function AudioMessagePlayer({ src, fromMe }: { src: string; fromMe: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const barCount = 36;

  // Carregar duração e waveform ao montar
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !src) return;

    const onLoadedMetadata = () => setDuration(audio.duration);
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onEnded = () => setPlaying(false);

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);

    (async () => {
      try {
        const res = await fetch(src, { mode: 'cors' });
        const buf = await res.arrayBuffer();
        const ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(buf);
        const channel = decoded.getChannelData(0);
        const blockSize = Math.floor(channel.length / barCount);
        const peaks: number[] = [];
        for (let i = 0; i < barCount; i++) {
          let sum = 0;
          const start = i * blockSize;
          for (let j = 0; j < blockSize && start + j < channel.length; j++) {
            sum += Math.abs(channel[start + j]);
          }
          peaks.push(Math.min(1, (sum / blockSize) * 4));
        }
        const max = Math.max(...peaks, 0.1);
        setWaveform(peaks.map((p) => p / max));
      } catch {
        setWaveform(Array(barCount).fill(0.4));
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
    };
  }, [src]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
    setPlaying(!playing);
  };

  const onWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    const el = e.currentTarget;
    if (!audio || !duration) return;
    const x = e.clientX - el.getBoundingClientRect().left;
    const pct = Math.max(0, Math.min(1, x / el.offsetWidth));
    audio.currentTime = pct * duration;
    setCurrentTime(audio.currentTime);
  };

  const formatT = (s: number) => {
    if (!Number.isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  const progress = duration > 0 ? currentTime / duration : 0;
  const barBg = fromMe ? 'bg-white/30' : 'bg-gray-400/40';
  const barFill = fromMe ? 'bg-white' : 'bg-gray-700';
  const textColor = fromMe ? 'text-white/90' : 'text-gray-600 dark:text-gray-300';

  return (
    <div className="flex items-center gap-2 min-w-[200px] max-w-[280px]">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        onClick={togglePlay}
        className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center shadow-md ${fromMe ? 'bg-white/20 hover:bg-white/30 text-white' : 'bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-800 dark:text-gray-100'}`}
        aria-label={playing ? 'Pausar' : 'Reproduzir'}
      >
        {playing ? <Pause className="w-5 h-5" fill="currentColor" /> : <Play className="w-5 h-5 ml-0.5" fill="currentColor" />}
      </button>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div
          role="progressbar"
          aria-valuenow={duration ? (currentTime / duration) * 100 : 0}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={0}
          onClick={onWaveformClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onWaveformClick(e as unknown as React.MouseEvent<HTMLDivElement>);
            }
          }}
          className="flex items-stretch gap-[2px] h-8 cursor-pointer rounded overflow-hidden"
        >
          {loading ? (
            <div className="flex items-stretch gap-[2px] h-8 w-full animate-pulse">
              {Array(barCount).fill(0).map((_, i) => (
                <div key={i} className={`flex-1 min-w-[2px] h-full flex flex-col justify-end rounded-sm`}>
                  <div className={`w-full rounded-sm ${barBg}`} style={{ height: '60%' }} />
                </div>
              ))}
            </div>
          ) : (
            waveform.length > 0 &&
            waveform.map((h, i) => {
              const barHeightPct = Math.max(12, Math.round(h * 100));
              const isPlayed = (i + 1) / barCount <= progress;
              return (
                <div key={i} className="flex-1 min-w-[2px] h-full flex flex-col justify-end rounded-sm overflow-hidden" style={{ minWidth: 2 }}>
                  <div
                    className={`w-full rounded-sm transition-colors duration-100 flex-shrink-0 ${isPlayed ? barFill : barBg}`}
                    style={{ height: `${barHeightPct}%` }}
                  />
                </div>
              );
            })
          )}
        </div>
        <div className={`flex justify-between text-xs tabular-nums ${textColor}`}>
          <span>{formatT(currentTime)}</span>
          <span>{formatT(duration)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── MessageContent ────────────────────────────────────────────────────────────

function MessageContent({
  msg,
  fromMe,
  onMediaClick,
}: {
  msg: Message;
  fromMe: boolean;
  onMediaClick: (url: string, type: 'image' | 'video', caption?: string | null) => void;
}) {
  const textClass = fromMe ? 'text-white/90' : 'text-gray-600 dark:text-gray-300';
  return (
    <div className="space-y-1">
      {msg.media_type === 'image' && (
        msg.media_url ? (
          <img
            src={msg.media_url}
            alt={msg.caption ?? 'imagem'}
            className="rounded-lg max-w-xs max-h-64 object-cover cursor-pointer"
            onClick={() => onMediaClick(msg.media_url!, 'image', msg.caption)}
          />
        ) : (
          <span className={`text-sm italic ${textClass}`}>📷 Imagem não disponível</span>
        )
      )}
      {msg.media_type === 'audio' && (
        msg.media_url ? (
          <AudioMessagePlayer src={msg.media_url} fromMe={fromMe} />
        ) : (
          <span className={`text-sm italic ${textClass}`}>🎵 Áudio não disponível</span>
        )
      )}
      {msg.media_type === 'video' && (
        msg.media_url ? (
          <div className="relative cursor-pointer group max-w-xs" onClick={() => onMediaClick(msg.media_url!, 'video', msg.caption)}>
            <video src={msg.media_url} className="rounded-lg max-w-xs max-h-64 pointer-events-none" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-lg group-hover:bg-black/50 transition-colors">
              <div className="w-12 h-12 bg-white/90 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-gray-800 ml-1" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
          </div>
        ) : (
          <span className={`text-sm italic ${textClass}`}>🎬 Vídeo não disponível</span>
        )
      )}
      {msg.media_type === 'document' && (
        msg.media_url ? (
          <a
            href={msg.media_url}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-2 text-sm underline ${fromMe ? 'text-white/90' : 'text-blue-400'}`}
          >
            <FileText size={16} /> {msg.caption ?? 'Documento'}
          </a>
        ) : (
          <span className={`text-sm italic ${textClass}`}>📄 Documento não disponível</span>
        )
      )}
      {msg.caption && msg.media_type && msg.media_type !== 'text' && msg.media_type !== 'video' && (
        <p className={`text-sm mt-1 ${textClass}`}>{msg.caption}</p>
      )}
      {(!msg.media_type || msg.media_type === 'text') && msg.text != null && msg.text !== '' && (
        <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>
      )}
    </div>
  );
}

type UserStatus = 'super_admin' | 'admin' | 'suporte' | string | null;

const CONVERSATIONS_PAGE_SIZE = 10;
const MESSAGES_PAGE_SIZE = 50;

// ─── ChatPage ─────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const { checking, userId, userStatus: authUserStatus } = useRequireAuth();
  const [userStatus, setUserStatus] = useState<UserStatus>((authUserStatus as UserStatus) ?? null);
  const [mediaModal, setMediaModal] = useState<{ url: string; type: 'image' | 'video'; caption?: string | null } | null>(null);

  // Canais
  const [channels, setChannels] = useState<{
    evolution: ChannelEvolution[];
    whatsapp_official: ChannelWhatsAppOfficial[];
  }>({ evolution: [], whatsapp_official: [] });
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);

  // Conversas
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string>('');
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [visibleConversationsCount, setVisibleConversationsCount] = useState(CONVERSATIONS_PAGE_SIZE);
  const [searchTerm, setSearchTerm] = useState('');
  const [conversationFilter, setConversationFilter] = useState<ConversationFilter>('all');
  const [tagFilter, setTagFilter] = useState<string>(''); // nome da etiqueta para filtrar (vazio = todas)
  const [tagOptions, setTagOptions] = useState<{ id: string; name: string; color?: string | null }[]>([]);
  const conversationListScrollRef = useRef<HTMLDivElement>(null);

  // Mensagens
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Envio
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [attachedMedia, setAttachedMedia] = useState<{
    url: string;
    type: 'image' | 'audio' | 'video' | 'document';
    name: string;
    preview?: string;
    meta_id?: string; // ID do upload direto na Meta (para áudio gravado)
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Cache de conversas por canal — permite exibição imediata ao trocar de canal
  const conversationsCacheRef = useRef<Record<string, Conversation[]>>({});

  // Sync de histórico WhatsApp Oficial — controla quais canais já foram sincronizados nesta sessão
  const waSyncedChannelsRef = useRef<Set<string>>(new Set());
  const [waHistorySyncing, setWaHistorySyncing] = useState(false);

  // Sync de histórico Evolution — controla quais instâncias já foram sincronizadas nesta sessão
  const evoSyncedChannelsRef = useRef<Set<string>>(new Set());
  const [evoHistorySyncing, setEvoHistorySyncing] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingLevels, setRecordingLevels] = useState<number[]>([0.2, 0.3, 0.4, 0.5, 0.4, 0.3, 0.2]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recordingAnimationRef = useRef<number | null>(null);

  // Alertas
  const [showTokenAlert, setShowTokenAlert] = useState(false);
  const [tokenAlertMessage, setTokenAlertMessage] = useState('');
  const [showResolveMenu, setShowResolveMenu] = useState(false);
  const [resolvingConversation, setResolvingConversation] = useState(false);
  const [showTagsPopover, setShowTagsPopover] = useState(false);
  const tagsPopoverRef = useRef<HTMLDivElement>(null);
  const [updatingTags, setUpdatingTags] = useState(false);
  const [spellChecking, setSpellChecking] = useState(false);
  const [spellCheckBadge, setSpellCheckBadge] = useState<'fixed' | 'ok' | null>(null);

  // Menu de conversa (MoreVertical)
  const [showConvMenu, setShowConvMenu] = useState(false);
  const convMenuRef = useRef<HTMLDivElement>(null);
  const [reopeningConversation, setReopeningConversation] = useState(false);

  // Deleção de mensagem
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);

  // Navegação
  const [activeView, setActiveView] = useState<ActiveView>('chat');
  const [isMobile, setIsMobile] = useState(false);
  const [chatSidebarOpen, setChatSidebarOpen] = useState(false);
  const [conversationsListHidden, setConversationsListHidden] = useState(false);

  // Contatos
  // undefined = não verificado ainda; null = não existe; ChatContact = existe
  const [convContact, setConvContact] = useState<ChatContact | null | undefined>(undefined);
  const [showContactModal, setShowContactModal] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', phone: '', horario: '' });
  const [savingContact, setSavingContact] = useState(false);
  const [contactSaveError, setContactSaveError] = useState<string | null>(null);

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

  // ── Perfil (sobrescreve status do auth; garante etiquetas mesmo antes do fetch) ──
  useEffect(() => {
    if (authUserStatus) setUserStatus(authUserStatus as UserStatus);
  }, [authUserStatus]);

  useEffect(() => {
    if (!userId) return;
    fetch('/api/user/profile', { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.data?.status) setUserStatus(data.data.status);
      })
      .catch(() => {});
  }, [userId]);

  // ── Canais ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    fetch('/api/chat/channels', { headers: authHeaders() })
      .then((r) => r.json())
      .then((result) => {
        if (result.success && result.data) {
          const evo: ChannelEvolution[] = result.data.evolution || [];
          const wa: ChannelWhatsAppOfficial[] = result.data.whatsapp_official || [];
          setChannels({ evolution: evo, whatsapp_official: wa });
          // Prioridade: WhatsApp Oficial > Evolution
          const defaultChannel = wa.length > 0 ? wa[0] : evo.length > 0 ? evo[0] : null;
          if (!selectedChannel && defaultChannel) {
            setSelectedChannel(defaultChannel);
          }
          // Pré-carrega conversas de TODOS os canais em paralelo
          const allChannels: Array<{ id: string; type: 'evolution' | 'whatsapp_official' }> = [
            ...evo.map((c) => ({ id: c.id, type: 'evolution' as const })),
            ...wa.map((c) => ({ id: c.id, type: 'whatsapp_official' as const })),
          ];
          allChannels.forEach(({ id, type }) => {
            const params = type === 'evolution' ? `instance_id=${id}` : `whatsapp_config_id=${id}`;
            fetch(`/api/chat/conversations?${params}`, { headers: authHeaders() })
              .then((r) => r.json())
              .then((res) => {
                if (res.success) {
                  conversationsCacheRef.current[id] = res.data || [];
                  // Se este canal já está selecionado, popula imediatamente
                  setSelectedChannel((ch) => {
                    if (ch?.id === id) setConversations(res.data || []);
                    return ch;
                  });
                }
              })
              .catch(() => {});
          });
        }
      })
      .catch((e) => console.error('[Chat] canais:', e));
  }, [userId]);

  // ── Carregar Conversas ─────────────────────────────────────────────────────
  const loadConversationsFromApi = useCallback(
    async (keepSelectionIfPresent = false) => {
      if (!selectedChannel) return;

      // Exibe do cache imediatamente (sem spinner) se disponível
      const cached = conversationsCacheRef.current[selectedChannel.id];
      if (cached && cached.length > 0) {
        setConversations(cached);
      } else {
        setConversationsLoading(true);
      }

      try {
        const params =
          selectedChannel.type === 'evolution'
            ? `instance_id=${selectedChannel.id}`
            : `whatsapp_config_id=${selectedChannel.id}`;

        const response = await fetch(`/api/chat/conversations?${params}`, { headers: authHeaders() });
        const result = await response.json();
        if (result.success) {
          const list: Conversation[] = result.data || [];
          conversationsCacheRef.current[selectedChannel.id] = list;
          setConversations(list);
          if (keepSelectionIfPresent) {
            setSelectedConversationId((prev) =>
              prev && list.some((c) => c.id === prev) ? prev : ''
            );
          }
        }
      } catch (error) {
        console.error('[Chat] carregar conversas:', error);
      } finally {
        setConversationsLoading(false);
      }
    },
    [selectedChannel]
  );

  // Sync paginado de todos os eventos da tabela webhook_events para chat_conversations/messages.
  // Executa reprocess_all=true uma vez por canal por sessão para garantir histórico completo.
  const syncWaHistoryFull = useCallback(
    async (channelId: string) => {
      if (waSyncedChannelsRef.current.has(channelId)) return;

      setWaHistorySyncing(true);
      const PAGE = 200;
      let offset = 0;
      let hasMore = true;

      try {
        while (hasMore) {
          const res = await fetch('/api/chat/webhook-events/process-pending', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ limit: PAGE, offset, reprocess_all: true }),
          });
          const json = await res.json();
          if (!json.success) break;
          hasMore = json.data?.has_more === true;
          offset = json.data?.next_offset ?? offset + PAGE;

          // Atualiza conversas já no meio do sync para mostrar resultados progressivamente
          if (json.data?.processed > 0) {
            loadConversationsFromApi(true);
          }
        }
        waSyncedChannelsRef.current.add(channelId);
      } catch (err) {
        console.error('[Chat] syncWaHistoryFull:', err);
      } finally {
        setWaHistorySyncing(false);
        loadConversationsFromApi(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadConversationsFromApi]
  );

  // Sync paginado de eventos Evolution da tabela evolution_webhook_events → chat
  const syncEvolutionHistoryFull = useCallback(
    async (channel: ChannelEvolution) => {
      if (evoSyncedChannelsRef.current.has(channel.id)) return;

      setEvoHistorySyncing(true);
      const PAGE = 200;
      let offset = 0;
      let hasMore = true;

      try {
        while (hasMore) {
          const res = await fetch('/api/chat/evolution-events/process-pending', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ instance_name: channel.instance_name, limit: PAGE, offset, reprocess_all: true }),
          });
          const json = await res.json();
          if (!json.success) break;
          hasMore = json.data?.has_more === true;
          offset = json.data?.next_offset ?? offset + PAGE;

          if (json.data?.processed > 0) {
            loadConversationsFromApi(true);
          }
        }
        evoSyncedChannelsRef.current.add(channel.id);
      } catch (err) {
        console.error('[Chat] syncEvolutionHistoryFull:', err);
      } finally {
        setEvoHistorySyncing(false);
        loadConversationsFromApi(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadConversationsFromApi]
  );

  useEffect(() => {
    if (!selectedChannel) return;

    if (selectedChannel.type === 'whatsapp_official') {
      // Primeira vez no canal desta sessão: sync completo de histórico (reprocess_all)
      syncWaHistoryFull(selectedChannel.id);
    } else if (selectedChannel.type === 'evolution') {
      // Evolution: sync da tabela evolution_webhook_events + carrega conversas
      syncEvolutionHistoryFull(selectedChannel as ChannelEvolution);
    } else {
      loadConversationsFromApi(false);
    }
  }, [selectedChannel, loadConversationsFromApi, syncWaHistoryFull, syncEvolutionHistoryFull]);

  // Etiquetas disponíveis (criadas pelo admin) para filtro e para marcar conversas
  useEffect(() => {
    if (!userId || !(userStatus === 'suporte' || userStatus === 'admin' || userStatus === 'super_admin')) return;
    fetch('/api/chat/tags', { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && Array.isArray(data.data)) {
          setTagOptions(data.data.map((t: { id: string; name: string; color?: string | null }) => ({ id: t.id, name: t.name, color: t.color })));
        }
      })
      .catch(() => {});
  }, [userId, userStatus]);

  // Refetch ao voltar à aba (conversas e etiquetas)
  useEffect(() => {
    if (!selectedChannel) return;
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      loadConversationsFromApi(true);
      if (userStatus === 'suporte' || userStatus === 'admin' || userStatus === 'super_admin') {
        fetch('/api/chat/tags', { headers: authHeaders() })
          .then((r) => r.json())
          .then((data) => {
            if (data.success && Array.isArray(data.data)) {
              setTagOptions(data.data.map((t: { id: string; name: string; color?: string | null }) => ({ id: t.id, name: t.name, color: t.color })));
            }
          })
          .catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [selectedChannel, loadConversationsFromApi, userStatus]);

  // ── Carregar Mensagens (últimas 50 — mais recentes primeiro via DESC+reverse) ──
  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      setHasOlderMessages(false);
      setConvContact(undefined);
      return;
    }

    const loadMessages = async () => {
      setMessagesLoading(true);
      try {
        const response = await fetch(
          `/api/chat/messages?conversation_id=${selectedConversationId}&limit=${MESSAGES_PAGE_SIZE}`,
          { headers: authHeaders() }
        );
        const result = await response.json();
        if (result.success) {
          setMessages(result.data || []);
          setHasOlderMessages(result.meta?.has_more === true);
        }
      } catch (error) {
        console.error('[Chat] carregar mensagens:', error);
      } finally {
        setMessagesLoading(false);
      }
    };

    loadMessages();
  }, [selectedConversationId]);

  // ── Scroll infinito para cima: carrega mensagens mais antigas ──────────────
  const loadOlderMessages = useCallback(async () => {
    if (!selectedConversationId || loadingOlderMessages || !hasOlderMessages) return;
    const oldestTs = messages[0]?.timestamp;
    if (!oldestTs) return;

    setLoadingOlderMessages(true);
    const container = messagesContainerRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;

    try {
      const response = await fetch(
        `/api/chat/messages?conversation_id=${selectedConversationId}&limit=${MESSAGES_PAGE_SIZE}&before_timestamp=${oldestTs}`,
        { headers: authHeaders() }
      );
      const result = await response.json();
      if (result.success) {
        const older: Message[] = result.data || [];
        setHasOlderMessages(result.meta?.has_more === true);
        if (older.length > 0) {
          setMessages((prev) => [...older, ...prev]);
          // Preserva a posição do scroll após inserir mensagens acima
          requestAnimationFrame(() => {
            if (container) container.scrollTop = container.scrollHeight - prevScrollHeight;
          });
        }
      }
    } catch (error) {
      console.error('[Chat] carregar mensagens antigas:', error);
    } finally {
      setLoadingOlderMessages(false);
    }
  }, [selectedConversationId, loadingOlderMessages, hasOlderMessages, messages]);

  // Scroll automático ao abrir conversa (vai para o final)
  useEffect(() => {
    if (!selectedConversationId || messagesLoading) return;
    const timeout = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 80);
    return () => clearTimeout(timeout);
  }, [selectedConversationId, messagesLoading]);

  // Handler de scroll das mensagens: topo → carrega mais antigas
  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container || !hasOlderMessages || loadingOlderMessages) return;
    if (container.scrollTop < 80) loadOlderMessages();
  }, [hasOlderMessages, loadingOlderMessages, loadOlderMessages]);

  // ── Lookup de contato ao selecionar conversa ───────────────────────────────
  useEffect(() => {
    if (!selectedConversationId || !userId) {
      setConvContact(undefined);
      return;
    }
    const conv = conversations.find((c) => c.id === selectedConversationId);
    if (!conv) { setConvContact(undefined); return; }

    const phone = conv.remote_jid.replace(/@s\.whatsapp\.net$/, '').replace(/\D/g, '');
    if (!phone) {
      setConvContact(null);
      return;
    }
    setConvContact(undefined);

    fetch(`/api/chat/contacts?phone=${phone}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => setConvContact(data.success ? (data.data ?? null) : null))
      .catch(() => setConvContact(null));
  }, [selectedConversationId, userId]);

  // ── Realtime: mensagens ────────────────────────────────────────────────────
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
            const raw = payload.new as Message;
            const msg: Message = {
              ...raw,
              timestamp:
                typeof raw.timestamp === 'string' ? parseInt(raw.timestamp, 10) : raw.timestamp,
            };
            setMessages((prev) => {
              if (prev.some((m) => m.id === msg.id)) return prev;
              return [...prev, msg];
            });
            const container = messagesContainerRef.current;
            const isAtBottom = container
              ? container.scrollHeight - container.scrollTop - container.clientHeight < 100
              : true;
            if (isAtBottom) {
              setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
            }
          } else if (payload.eventType === 'UPDATE') {
            const raw = payload.new as Message;
            const msg: Message = {
              ...raw,
              timestamp:
                typeof raw.timestamp === 'string' ? parseInt(raw.timestamp, 10) : raw.timestamp,
            };
            setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
          } else if (payload.eventType === 'DELETE') {
            setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
          }
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn('[Chat] Realtime CHANNEL_ERROR — verifique migrations/fix_chat_realtime_publication_and_replica.sql');
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [selectedConversationId]);

  // ── Realtime: webhook_events (WhatsApp Oficial) ────────────────────────────
  // Processa eventos brutos da tabela webhook_events em tempo real.
  // Após processar, recarrega a lista de conversas para refletir novas mensagens.
  useEffect(() => {
    if (!selectedChannel || selectedChannel.type !== 'whatsapp_official' || !userId) return;

    const processAndRefresh = (eventId: string) => {
      fetch('/api/chat/webhook-events/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ event_id: eventId }),
      })
        .then((r) => r.json())
        .then((res) => {
          if (res.success && !res.data?.skipped) {
            // Evento processado com sucesso — recarrega conversas
            loadConversationsFromApi(true);
          }
        })
        .catch((e) => console.error('[Chat] webhook_events process:', e));
    };

    const channel = supabase
      .channel('webhook_events_whatsapp_official')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'webhook_events', filter: 'source=eq.whatsapp_official' },
        (payload) => {
          const row = payload.new as { id?: string };
          if (!row?.id) return;
          processAndRefresh(row.id);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedChannel, userId, loadConversationsFromApi]);

  // ── Realtime: evolution_webhook_events (Evolution) ─────────────────────────
  // Processa eventos brutos da tabela evolution_webhook_events em tempo real.
  // Espelha o comportamento do listener de webhook_events do WA Oficial.
  useEffect(() => {
    if (!selectedChannel || selectedChannel.type !== 'evolution' || !userId) return;
    const evoChannel = selectedChannel as ChannelEvolution;

    const processAndRefresh = (eventId: string) => {
      fetch('/api/chat/evolution-events/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ event_id: eventId }),
      })
        .then((r) => r.json())
        .then((res) => {
          if (res.success && !res.data?.skipped) {
            loadConversationsFromApi(true);
          }
        })
        .catch(() => {});
    };

    const CHAT_EVENT_TYPES = ['MESSAGES_UPSERT', 'SEND_MESSAGE', 'MESSAGES_UPDATE', 'MESSAGES_DELETE'];

    const channel = supabase
      .channel(`evolution_webhook_events_${evoChannel.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'evolution_webhook_events',
          filter: `instance_name=eq.${evoChannel.instance_name}`,
        },
        (payload) => {
          const row = payload.new as { id?: string; event_type?: string };
          if (!row?.id) return;
          // Só processa eventos relevantes ao chat
          if (CHAT_EVENT_TYPES.some((t) => row.event_type?.toUpperCase().includes(t.replace('_', '.')))) {
            processAndRefresh(row.id);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedChannel, userId, loadConversationsFromApi]);

  // ── Realtime: conversas ────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedChannel) return;

    const filterCol = selectedChannel.type === 'evolution' ? 'instance_id' : 'whatsapp_config_id';
    const filterVal = selectedChannel.id;
    const canNotify = userStatus === 'super_admin' || userStatus === 'admin' || userStatus === 'suporte';

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
              const w24 = (c: Conversation) =>
                !!c.whatsapp_config_id &&
                !!c.last_customer_message_at &&
                Date.now() - new Date(c.last_customer_message_at).getTime() < 86_400_000;
              const sort24 = (arr: Conversation[]) =>
                [...arr].sort((a, b) => {
                  const a24 = w24(a), b24 = w24(b);
                  if (a24 && !b24) return -1;
                  if (!a24 && b24) return 1;
                  return new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime();
                });
              const updated = prev.findIndex((c) => c.id === newConv.id) >= 0
                ? prev.map((c) => (c.id === newConv.id ? newConv : c))
                : [newConv, ...prev];
              const sorted = sort24(updated);
              // Atualizar cache também
              const cacheKey = filterVal;
              if (conversationsCacheRef.current[cacheKey]) {
                conversationsCacheRef.current[cacheKey] = sorted;
              }
              return sorted;
            });

            if (isNew && canNotify && typeof window !== 'undefined' && 'Notification' in window) {
              const convTitle = newConv.title || 'Nova conversa';
              const preview = (newConv.last_message_preview || '').slice(0, 60);
              if (document.visibilityState === 'hidden' && Notification.permission === 'granted') {
                try {
                  new Notification('Nova conversa no Chat — Zaploto', {
                    body: preview
                      ? `${convTitle}: ${preview}${preview.length >= 60 ? '...' : ''}`
                      : convTitle,
                    icon: '/favicon.ico',
                  });
                } catch (_) {}
              }
            }
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedChannel, userStatus]);

  // ── Permissão de notificação ───────────────────────────────────────────────
  useEffect(() => {
    const canNotify = userStatus === 'super_admin' || userStatus === 'admin' || userStatus === 'suporte';
    if (!canNotify || typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  }, [userStatus]);

  // ── Upload de arquivo ──────────────────────────────────────────────────────
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedChannel || selectedChannel.type !== 'whatsapp_official') return;
    setUploading(true);
    e.target.value = '';
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('config_id', selectedChannel.id);
      const res = await fetch('/api/chat/whatsapp-official/upload-media', {
        method: 'POST',
        body: formData,
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!data.success) { alert(data.error || data.message || 'Falha no upload'); return; }
      const preview = data.data.media_type === 'image' ? URL.createObjectURL(file) : undefined;
      setAttachedMedia({ url: data.data.url, type: data.data.media_type, name: file.name, preview });
    } catch (err) {
      console.error('[Chat] upload:', err);
      alert('Falha ao enviar arquivo');
    } finally {
      setUploading(false);
    }
  };

  // ── Gravação de áudio (preferir MP4/M4A quando suportado) ──────────────────
  const getPreferredAudioMimeType = (): string => {
    const options = [
      'audio/mp4;codecs=mp4a',
      'audio/mp4',
      'audio/m4a',
      'audio/ogg;codecs=opus',
      'audio/webm;codecs=opus',
      'audio/webm',
    ];
    for (const m of options) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
    }
    return 'audio/webm;codecs=opus';
  };

  const startRecording = async () => {
    if (!selectedChannel || selectedChannel.type !== 'whatsapp_official') {
      alert('Gravação de áudio disponível apenas para WhatsApp Oficial');
      return;
    }
    if (!userId) {
      alert('Faça login para gravar áudio.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getPreferredAudioMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: mimeType });
        await uploadRecordedAudio(blob, mimeType);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);

      // Ondas visuais: AudioContext + AnalyserNode
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const bars = 7;
        const step = Math.floor(dataArray.length / bars);
        const levels = Array.from({ length: bars }, (_, i) => {
          const v = dataArray[i * step] ?? 0;
          return Math.min(1, (v / 255) * 1.2 + 0.15);
        });
        setRecordingLevels(levels);
        recordingAnimationRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      alert('Não foi possível acessar o microfone. Verifique as permissões.');
    }
  };

  const stopRecording = () => {
    if (recordingAnimationRef.current != null) {
      cancelAnimationFrame(recordingAnimationRef.current);
      recordingAnimationRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    setRecordingSeconds(0);
    setRecordingLevels([0.2, 0.3, 0.4, 0.5, 0.4, 0.3, 0.2]);
  };

  const uploadRecordedAudio = async (blob: Blob, mimeType: string) => {
    if (!selectedChannel || selectedChannel.type !== 'whatsapp_official' || !userId) return;
    setUploading(true);
    try {
      const baseType = mimeType.split(';')[0].trim().toLowerCase();
      const extMap: Record<string, string> = {
        'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a',
        'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/mpeg': 'mp3',
      };
      const ext = extMap[baseType] ?? 'ogg';
      const fileName = `audio_${Date.now()}.${ext}`;

      // Dois uploads em paralelo:
      // 1. Meta  → media_id para envio confiável (independe de URL pública)
      // 2. Supabase → URL pública para exibição no chat interno
      const makeFormData = () => {
        const fd = new FormData();
        fd.append('file', new File([blob], fileName, { type: baseType }));
        fd.append('config_id', selectedChannel!.id);
        return fd;
      };

      const [metaResult, supResult] = await Promise.allSettled([
        fetch('/api/chat/whatsapp-official/upload-audio-meta', {
          method: 'POST', body: makeFormData(), headers: authHeaders(),
        }).then((r) => r.json()),
        fetch('/api/chat/whatsapp-official/upload-media', {
          method: 'POST', body: makeFormData(), headers: authHeaders(),
        }).then((r) => r.json()),
      ]);

      const metaData = metaResult.status === 'fulfilled' ? metaResult.value : null;
      const supData = supResult.status === 'fulfilled' ? supResult.value : null;

      const meta_id: string | undefined = metaData?.success ? metaData.data?.media_id : undefined;
      const url: string = supData?.success ? supData.data?.url : '';

      if (!meta_id && !url) {
        alert('Falha ao processar áudio. Tente novamente.');
        return;
      }

      setAttachedMedia({ url, meta_id, type: 'audio', name: 'Áudio gravado' });
    } catch (e) {
      console.error('[Chat] upload áudio:', e);
      alert('Falha ao enviar áudio gravado. Tente novamente.');
    } finally {
      setUploading(false);
    }
  };

  // ── Corretor ortográfico ───────────────────────────────────────────────────
  const handleSpellCheck = async () => {
    if (!messageText.trim() || spellChecking) return;
    setSpellChecking(true);
    setSpellCheckBadge(null);
    setSendError(null);
    try {
      const res = await fetch('/api/ai/spell-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ text: messageText }),
      });
      const data = await res.json().catch(() => ({ success: false, error: 'Resposta inválida' }));
      if (data.success) {
        setMessageText(data.data.corrected);
        setSpellCheckBadge(data.data.changed ? 'fixed' : 'ok');
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
          }
        }, 0);
        setTimeout(() => setSpellCheckBadge(null), 3000);
      } else {
        const msg = data.error || (res.status === 503 ? 'Corretor IA indisponível.' : 'Erro ao verificar ortografia.');
        setSendError(msg);
      }
    } catch {
      setSendError('Não foi possível conectar ao corretor. Tente novamente.');
    } finally {
      setSpellChecking(false);
    }
  };

  useEffect(() => {
    if (!showTagsPopover) return;
    const onOutside = (e: MouseEvent) => {
      if (tagsPopoverRef.current && !tagsPopoverRef.current.contains(e.target as Node)) {
        setShowTagsPopover(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [showTagsPopover]);

  useEffect(() => {
    if (!showConvMenu) return;
    const onOutside = (e: MouseEvent) => {
      if (convMenuRef.current && !convMenuRef.current.contains(e.target as Node)) {
        setShowConvMenu(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [showConvMenu]);

  const applyTagsToConversation = async (next: string[], closePopover = false) => {
    if (!selectedConversationId || updatingTags) return;
    const conv = conversations.find((c) => c.id === selectedConversationId);
    if (!conv) return;
    setUpdatingTags(true);
    if (closePopover) setShowTagsPopover(false);
    try {
      const res = await fetch('/api/chat/conversations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ conversation_id: selectedConversationId, tags: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setConversations((prev) =>
          prev.map((c) => (c.id === selectedConversationId ? { ...c, tags: next } : c))
        );
        const cacheKey = selectedChannel?.id ?? '';
        if (conversationsCacheRef.current[cacheKey]) {
          conversationsCacheRef.current[cacheKey] = conversationsCacheRef.current[cacheKey].map(
            (c) => (c.id === selectedConversationId ? { ...c, tags: next } : c)
          );
        }
      }
    } catch (e) {
      console.error('[Chat] Atualizar etiquetas:', e);
    } finally {
      setUpdatingTags(false);
    }
  };

  const handleToggleTag = async (tag: string) => {
    const conv = conversations.find((c) => c.id === selectedConversationId);
    if (!conv) return;
    const current = conv.tags || [];
    const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag].sort();
    await applyTagsToConversation(next, false);
  };

  const handleRemoveAllTags = async () => {
    await applyTagsToConversation([], true);
  };

  const handleResolveConversation = async () => {
    if (!selectedConversationId || resolvingConversation) return;
    const conv = conversations.find((c) => c.id === selectedConversationId);
    if (!conv || conv.attendance_status === 'resolvido') return;
    setResolvingConversation(true);
    setShowResolveMenu(false);
    try {
      const res = await fetch('/api/chat/conversations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          conversation_id: selectedConversationId,
          attendance_status: 'resolvido',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && data.data) {
        const updated = { ...conv, attendance_status: 'resolvido' as const, resolved_at: data.data.resolved_at };
        setConversations((prev) => prev.map((c) => c.id === selectedConversationId ? updated : c));
        conversationsCacheRef.current[selectedChannel?.id ?? ''] = (conversationsCacheRef.current[selectedChannel?.id ?? ''] || []).map((c) => c.id === selectedConversationId ? updated : c);
      }
    } catch (e) {
      console.error('[Chat] Resolver conversa:', e);
    } finally {
      setResolvingConversation(false);
    }
  };

  const handleReopenConversation = async () => {
    if (!selectedConversationId || reopeningConversation) return;
    const conv = conversations.find((c) => c.id === selectedConversationId);
    if (!conv || conv.attendance_status !== 'resolvido') return;
    setReopeningConversation(true);
    setShowConvMenu(false);
    try {
      const res = await fetch('/api/chat/conversations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          conversation_id: selectedConversationId,
          attendance_status: 'pendente',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && data.data) {
        const updated = { ...conv, attendance_status: 'pendente' as const, resolved_at: null };
        setConversations((prev) => prev.map((c) => c.id === selectedConversationId ? updated : c));
        conversationsCacheRef.current[selectedChannel?.id ?? ''] = (conversationsCacheRef.current[selectedChannel?.id ?? ''] || []).map((c) => c.id === selectedConversationId ? updated : c);
      }
    } catch (e) {
      console.error('[Chat] Reabrir conversa:', e);
    } finally {
      setReopeningConversation(false);
    }
  };

  const handleDeleteMessage = async (messageRowId: string) => {
    if (deletingMessageId) return;
    setDeletingMessageId(messageRowId);
    try {
      const res = await fetch('/api/chat/messages', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ message_id: messageRowId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        // Realtime já remove, mas removemos também localmente para UX imediata
        setMessages((prev) => prev.filter((m) => m.id !== messageRowId));
      } else {
        console.error('[Chat] Apagar mensagem:', data.error || 'Erro desconhecido');
      }
    } catch (e) {
      console.error('[Chat] Apagar mensagem:', e);
    } finally {
      setDeletingMessageId(null);
      setHoveredMessageId(null);
    }
  };

  // ── Envio de mensagem ──────────────────────────────────────────────────────
  const getSendErrorMessage = (status: number, bodyError?: string): string => {
    if (bodyError && bodyError.trim()) return bodyError;
    switch (status) {
      case 502: return 'Serviço temporariamente indisponível. Tente novamente.';
      case 503: return 'Serviço em manutenção. Tente novamente em instantes.';
      case 504: return 'Tempo esgotado. A Meta pode estar lenta. Tente reenviar.';
      case 401: return 'Token inválido ou expirado. Renove em Admin > WhatsApp Oficial.';
      case 403: return 'Sem permissão para enviar. Verifique o canal e a janela de 24h.';
      case 400: return 'Dados inválidos. Verifique o número e o conteúdo da mensagem.';
      default:
        if (status >= 500) return 'Erro no servidor. Tente novamente.';
        return 'Não foi possível enviar. Tente novamente.';
    }
  };

  const handleSendMessage = async () => {
    const hasText = messageText.trim().length > 0;
    const hasMedia = !!attachedMedia;
    if ((!hasText && !hasMedia) || !selectedConversationId || !selectedChannel || sending) return;
    if (selectedChannel.type === 'whatsapp_official' && !canSendFreeMessage) {
      setSendError('Fora da janela de 24h. Use mensagem template para iniciar ou reabrir a conversa.');
      return;
    }

    const conversation = conversations.find((c) => c.id === selectedConversationId);
    if (!conversation) return;

    setSendError(null);
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
        let result: { success?: boolean; error?: string; message?: string } = {};
        try { result = await response.json(); } catch { result = {}; }
        if (response.ok && result.success) {
          setMessageText('');
          if (textareaRef.current) textareaRef.current.style.height = 'auto';
        } else {
          setSendError(getSendErrorMessage(response.status, result.error || result.message));
        }
      } else {
        const to =
          (conversation.remote_jid || '')
            .replace(/@s\.whatsapp\.net$/, '')
            .replace(/\D/g, '') || conversation.remote_jid;
        const body: Record<string, string | undefined> = hasMedia
          ? {
              config_id: selectedChannel.id,
              to,
              type: attachedMedia!.type,
              // Para áudio gravado: usa meta_id (upload direto na Meta) — garante entrega
              // Para outros tipos ou fallback: usa media_url (URL pública Supabase)
              ...(attachedMedia!.meta_id
                ? { meta_id: attachedMedia!.meta_id }
                : { media_url: attachedMedia!.url }),
              caption: hasText ? messageText.trim() : undefined,
            }
          : { config_id: selectedChannel.id, to, type: 'text', text: messageText.trim() };

        const response = await fetch('/api/chat/whatsapp-official/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(body),
        });
        let result: { success?: boolean; error?: string; message?: string } = {};
        try { result = await response.json(); } catch { result = {}; }
        if (response.ok && result.success) {
          if (attachedMedia?.preview) URL.revokeObjectURL(attachedMedia.preview);
          setMessageText('');
          setAttachedMedia(null);
          if (textareaRef.current) textareaRef.current.style.height = 'auto';
        } else {
          setSendError(getSendErrorMessage(response.status, result.error || result.message));
        }
      }
    } catch (error) {
      const isNetwork =
        error instanceof TypeError &&
        (error.message === 'Failed to fetch' || error.message?.includes('network'));
      setSendError(
        isNetwork
          ? 'Falha na conexão. Verifique sua internet e tente novamente.'
          : 'Erro ao enviar mensagem. Tente novamente.'
      );
    } finally {
      setSending(false);
    }
  };

  // ── Contato: abrir modal ───────────────────────────────────────────────────
  const openContactModal = () => {
    const conv = conversations.find((c) => c.id === selectedConversationId);
    const phone =
      conv?.remote_jid.replace(/@s\.whatsapp\.net$/, '').replace(/\D/g, '') ?? '';
    setContactForm({
      name: convContact?.name ?? conv?.title ?? '',
      phone,
      horario: convContact?.horario ?? '',
    });
    setContactSaveError(null);
    setShowContactModal(true);
  };

  const handleSaveContact = async () => {
    if (!contactForm.phone) { setContactSaveError('Telefone é obrigatório'); return; }
    setSavingContact(true);
    setContactSaveError(null);
    try {
      const res = await fetch('/api/chat/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(contactForm),
      });
      const data = await res.json();
      if (data.success) {
        setConvContact(data.data);
        setShowContactModal(false);
      } else {
        setContactSaveError(data.error || 'Erro ao salvar contato');
      }
    } catch {
      setContactSaveError('Falha na conexão. Tente novamente.');
    } finally {
      setSavingContact(false);
    }
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  const formatTime = (timestamp: number | string) => {
    const date =
      typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp * 1000);
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
    const date =
      typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp * 1000);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString('pt-BR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'sent': return <Check className="w-4 h-4" />;
      case 'delivered': return <CheckCheck className="w-4 h-4" />;
      case 'read': return <CheckCheck className="w-4 h-4" style={{ color: '#8CD955' }} />;
      default: return <Clock className="w-4 h-4" />;
    }
  };

  const getInitials = (name: string) =>
    name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

  const isWithin24hWindow = (conv: Conversation): boolean => {
    if (!conv.whatsapp_config_id || !conv.last_customer_message_at) return false;
    return Date.now() - new Date(conv.last_customer_message_at).getTime() < 24 * 60 * 60 * 1000;
  };

  const getConversationColor = (title: string) => {
    const colors = ['#8CD955', '#7BC84A', '#6AB83D', '#A8E677', '#5AA832', '#4C9628', '#3E841E', '#2F7214'];
    return colors[(title.charCodeAt(0) || 0) % colors.length];
  };

  // ── Filtros e ordenação ────────────────────────────────────────────────────
  // isActiveConversation:
  //   - WhatsApp Oficial: dentro da janela 24h E não resolvida
  //   - Evolution: qualquer conversa não resolvida (sem conceito de janela 24h)
  const isActiveConversation = (conv: Conversation): boolean => {
    const resolved = conv.attendance_status === 'resolvido';
    if (conv.whatsapp_config_id) {
      return isWithin24hWindow(conv) && !resolved;
    }
    return !resolved;
  };

  const filteredConversations = conversations.filter((conv) => {
    const term = (searchTerm || '').trim().toLowerCase();
    const matchesSearch =
      !term ||
      (conv.title || '').toLowerCase().includes(term) ||
      (conv.last_message_preview || '').toLowerCase().includes(term) ||
      (conv.tags || []).some((t) => t.toLowerCase().includes(term));
    if (!matchesSearch) return false;
    if (tagFilter) {
      const hasTag = (conv.tags || []).some((t) => t === tagFilter);
      if (!hasTag) return false;
    }
    switch (conversationFilter) {
      case 'mine':
        return conv.user_id === userId;
      case 'unassigned':
        // Histórico: resolvidas, ou WA Oficial fora da janela 24h
        return !isActiveConversation(conv);
      case 'all':
      default:
        // Todos: ativas e não resolvidas
        return isActiveConversation(conv);
    }
  });

  // Ordenação: 24h ativos primeiro, depois por última mensagem
  const sortedConversations = [...filteredConversations].sort((a, b) => {
    const a24 = isWithin24hWindow(a);
    const b24 = isWithin24hWindow(b);
    if (a24 && !b24) return -1;
    if (!a24 && b24) return 1;
    return (
      new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime()
    );
  });

  const displayedConversations = sortedConversations.slice(0, visibleConversationsCount);
  const hasMoreConversations = visibleConversationsCount < sortedConversations.length;

  const allCount = conversations.filter((c) => isActiveConversation(c)).length;
  const mineCount = conversations.filter((c) => c.user_id === userId).length;
  const historyCount = conversations.filter((c) => !isActiveConversation(c)).length;

  useEffect(() => {
    setVisibleConversationsCount(CONVERSATIONS_PAGE_SIZE);
  }, [conversationFilter, searchTerm, tagFilter]);

  // Detectar mobile para layout de conversa full-screen
  useEffect(() => {
    const check = () => setIsMobile(typeof window !== 'undefined' && window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const selectedConversation = conversations.find((c) => c.id === selectedConversationId);
  const canSendFreeMessage =
    selectedChannel?.type !== 'whatsapp_official' ||
    (selectedConversation ? isWithin24hWindow(selectedConversation) : false);

  if (checking) {
    return (
      <Layout onSignOut={handleSignOut}>
        <div className="flex items-center justify-center h-full bg-[var(--background)]">
          <div className="text-[var(--muted-foreground)]">Carregando...</div>
        </div>
      </Layout>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Layout onSignOut={handleSignOut}>
      {mediaModal && (
        <MediaModal
          url={mediaModal.url}
          type={mediaModal.type}
          caption={mediaModal.caption}
          onClose={() => setMediaModal(null)}
        />
      )}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

        {/* Token Alert */}
        {showTokenAlert && (
          <div
            className="flex-shrink-0 flex items-center justify-between gap-4 px-4 py-3 bg-amber-500/15 dark:bg-amber-500/20 border-b border-amber-500/40 text-amber-800 dark:text-amber-200"
            role="alert"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-5 h-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-sm font-medium">{tokenAlertMessage}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <a href="/admin/whatsapp-official" className="text-sm font-medium underline hover:no-underline">
                Renovar token
              </a>
              <button
                type="button"
                onClick={() => setShowTokenAlert(false)}
                className="p-1.5 rounded-lg hover:bg-amber-500/20 transition-colors"
                aria-label="Fechar aviso"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* 3 Painéis — coluna Zaploto Chat oculta por padrão; botão abre/fecha */}
        <div className="flex flex-1 min-h-0 overflow-hidden bg-gray-50 dark:bg-[#1e1e1e]">
          {!(isMobile && selectedConversationId) && (
          <>
          {/* ── Painel Esquerdo (Zaploto Chat) — visível só quando chatSidebarOpen ── */}
          {chatSidebarOpen && (
          <div className="w-48 md:w-64 min-h-0 flex-shrink-0 overflow-hidden bg-white dark:bg-[#2a2a2a] border-r border-gray-200 dark:border-[#404040] flex flex-col relative">
            <button
              type="button"
              onClick={() => setChatSidebarOpen(false)}
              className="absolute top-3 right-3 z-10 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-[#333] text-gray-500 dark:text-gray-400"
              aria-label="Fechar menu"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="p-4 border-b border-gray-200 dark:border-[#404040]">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3 pr-8">Zaploto Chat</h2>
              <div className="space-y-1">
                <button
                  onClick={() => setActiveView('chat')}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm font-medium ${
                    activeView === 'chat'
                      ? 'text-white'
                      : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#333]'
                  }`}
                  style={activeView === 'chat' ? { backgroundColor: '#8CD955' } : {}}
                >
                  <MessageCircle className="w-5 h-5" />
                  Todas as conversas
                </button>
                <button
                  onClick={() => setActiveView('contacts')}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm font-medium ${
                    activeView === 'contacts'
                      ? 'text-white'
                      : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#333]'
                  }`}
                  style={activeView === 'contacts' ? { backgroundColor: '#8CD955' } : {}}
                >
                  <BookUser className="w-5 h-5" />
                  Contatos
                </button>
              </div>
            </div>

            {/* Seletor de Canal */}
            {canSelectChannel ? (
              <div className="p-4 border-b border-gray-200 dark:border-[#404040]">
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
                  Canal
                </label>
                <select
                  value={selectedChannel ? `${selectedChannel.type}:${selectedChannel.id}` : ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) { setSelectedChannel(null); setSelectedConversationId(''); return; }
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
                  className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 border-gray-300 dark:border-[#404040]"
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
              {!selectedChannel && (
                <div className="text-center text-gray-500 dark:text-gray-400 text-sm mt-8">
                  {canSelectChannel ? 'Selecione um canal' : 'Carregando...'}
                </div>
              )}
            </div>
          </div>
          )}

          {/* ── Painel Central (lista) — ocultável com botão no header da conversa ── */}
          {!(conversationsListHidden && selectedConversationId) && (activeView === 'contacts' ? (
            /* Vista Contatos */
            <div className="min-w-0 flex-1 md:w-80 md:flex-shrink-0 overflow-hidden bg-white dark:bg-[#2a2a2a] border-r border-gray-200 dark:border-[#404040] flex flex-col">
              <div className="flex-shrink-0 p-3 border-b border-gray-200 dark:border-[#404040] flex items-center gap-2">
                {!chatSidebarOpen && (
                  <button
                    type="button"
                    onClick={() => setChatSidebarOpen(true)}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#333] text-gray-600 dark:text-gray-300 flex-shrink-0"
                    aria-label="Abrir menu Zaploto Chat"
                    title="Abrir menu (canal, conversas/contatos)"
                  >
                    <PanelLeft className="w-5 h-5" />
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Contatos do Chat</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    Clique em um contato para abrir a conversa.
                  </p>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {conversations.length === 0 ? (
                  <div className="p-6 text-center text-gray-500 dark:text-gray-400 text-sm">
                    Nenhuma conversa encontrada.
                  </div>
                ) : (
                  conversations
                    .filter((c) => !c.is_group)
                    .sort(
                      (a, b) =>
                        new Date(b.last_message_at || 0).getTime() -
                        new Date(a.last_message_at || 0).getTime()
                    )
                    .map((conv) => {
                      const phone = conv.remote_jid
                        .replace(/@s\.whatsapp\.net$/, '')
                        .replace(/\D/g, '');
                      return (
                        <div
                          key={conv.id}
                          onClick={() => {
                            setActiveView('chat');
                            setSelectedConversationId(conv.id);
                          }}
                          className="p-3 border-b border-gray-100 dark:border-[#404040] cursor-pointer hover:bg-gray-50 dark:hover:bg-[#333] transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                              style={{ backgroundColor: getConversationColor(conv.title || '') }}
                            >
                              {getInitials(conv.title || phone)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                {conv.title || 'Sem nome'}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">{phone}</p>
                            </div>
                            <span className="text-xs text-gray-400 flex-shrink-0">
                              {formatTime(conv.last_message_at)}
                            </span>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </div>
          ) : (
            /* Vista Chat — Lista de Conversas */
            <div className="min-w-0 flex-1 md:w-80 md:flex-shrink-0 overflow-hidden bg-white dark:bg-[#2a2a2a] border-r border-gray-200 dark:border-[#404040] flex flex-col">
              {/* Botão menu + Busca + Abas */}
              <div className="flex-shrink-0 p-3 border-b border-gray-200 dark:border-[#404040]">
                {!chatSidebarOpen && (
                  <div className="mb-2">
                    <button
                      type="button"
                      onClick={() => setChatSidebarOpen(true)}
                      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#333] text-gray-600 dark:text-gray-300 inline-flex items-center gap-2 text-sm font-medium"
                      aria-label="Abrir menu Zaploto Chat"
                      title="Abrir menu (canal, conversas/contatos)"
                    >
                      <PanelLeft className="w-5 h-5" />
                      Menu
                    </button>
                  </div>
                )}
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400 w-4 h-4" />
                  <input
                    type="text"
                    placeholder="Buscar..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 text-sm bg-gray-100 dark:bg-[#333] border border-gray-200 dark:border-[#404040] rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400"
                  />
                </div>
                {tagOptions.length > 0 && (
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Filtrar por etiqueta</label>
                    <select
                      value={tagFilter}
                      onChange={(e) => setTagFilter(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-gray-100 dark:bg-[#333] border border-gray-200 dark:border-[#404040] rounded-lg text-gray-900 dark:text-gray-100"
                    >
                      <option value="">Todas</option>
                      {tagOptions.map((t) => (
                        <option key={t.id} value={t.name}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex items-center gap-1 border-b border-gray-200 dark:border-[#404040] -mx-4 px-4">
                  {/* Todos = janela 24h ativa (prioridade máxima) */}
                  <button
                    onClick={() => setConversationFilter('all')}
                    className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                      conversationFilter === 'all'
                        ? 'border-[#8CD955] text-[#8CD955]'
                        : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                    }`}
                  >
                    Todos ({allCount})
                  </button>
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
                    Histórico ({historyCount})
                  </button>
                </div>
              </div>

              {/* Lista com scroll infinito */}
              <div
                ref={conversationListScrollRef}
                className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain"
                onScroll={() => {
                  const el = conversationListScrollRef.current;
                  if (!el || !hasMoreConversations) return;
                  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
                    setVisibleConversationsCount((prev) =>
                      Math.min(prev + CONVERSATIONS_PAGE_SIZE, sortedConversations.length)
                    );
                  }
                }}
              >
                {(waHistorySyncing || evoHistorySyncing) && conversations.length === 0 && (
                  <div className="px-3 py-2 flex items-center gap-2 bg-[#8CD95510] border-b border-[#8CD95530] text-[#5a9e2f] dark:text-[#8CD955] text-xs">
                    <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
                    <span>Sincronizando histórico de conversas...</span>
                  </div>
                )}
                {conversationsLoading && conversations.length === 0 ? (
                  <div className="p-4 flex items-center justify-center gap-2 text-gray-500 dark:text-gray-400 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Carregando conversas...
                  </div>
                ) : sortedConversations.length === 0 ? (
                  <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
                    {selectedChannel ? (
                      <>
                        {conversationFilter === 'all'
                          ? 'Nenhuma conversa com janela 24h ativa (pendente).'
                          : conversationFilter === 'unassigned'
                            ? 'Nenhuma conversa no histórico (template ou resolvidas).'
                            : 'Nenhuma conversa encontrada.'}
                        {(userStatus === 'super_admin' || userStatus === 'admin' || userStatus === 'suporte') && (
                          <p className="mt-1 text-xs">
                            Novas mensagens aparecerão aqui automaticamente.
                          </p>
                        )}
                      </>
                    ) : (
                      'Selecione um canal'
                    )}
                  </div>
                ) : (
                  <>
                    {displayedConversations.map((conv) => {
                      const isSelected = selectedConversationId === conv.id;
                      return (
                        <div
                          key={conv.id}
                          onClick={() => setSelectedConversationId(conv.id)}
                          className={`p-3 border-b border-gray-100 dark:border-[#404040] cursor-pointer hover:bg-gray-50 dark:hover:bg-[#333] transition-colors ${
                            isSelected
                              ? 'bg-[#8CD95515] dark:bg-[#8CD95520] border-l-4 border-l-[#8CD955]'
                              : ''
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div
                              className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                              style={{ backgroundColor: getConversationColor(conv.title || '') }}
                            >
                              {conv.is_group ? (
                                <Users className="w-5 h-5" />
                              ) : (
                                <span>{getInitials(conv.title || '')}</span>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate flex items-center gap-1.5 flex-wrap">
                                  {conv.title || 'Sem nome'}
                                  {selectedChannel?.type === 'whatsapp_official' &&
                                    conv.whatsapp_config_id && (
                                      <span
                                        className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded ${
                                          conv.attendance_status === 'resolvido'
                                            ? 'bg-slate-200 text-slate-700 dark:bg-slate-600 dark:text-slate-200'
                                            : isWithin24hWindow(conv)
                                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                                              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                                        }`}
                                      >
                                        {conv.attendance_status === 'resolvido'
                                          ? 'resolvido'
                                          : isWithin24hWindow(conv)
                                            ? '24h'
                                            : 'template'}
                                      </span>
                                    )}
                                  {(conv.tags || []).length > 0 && (
                                    <span className="flex-shrink-0 flex gap-0.5 flex-wrap">
                                      {(conv.tags || []).map((tag) => {
                                        const tagMeta = tagOptions.find((t) => t.name === tag);
                                        const bg = tagMeta?.color ?? '#3b82f6';
                                        return (
                                          <span
                                            key={tag}
                                            className="text-[10px] px-1.5 py-0.5 rounded text-white font-medium"
                                            style={{ backgroundColor: bg }}
                                          >
                                            {tag}
                                          </span>
                                        );
                                      })}
                                    </span>
                                  )}
                                </h3>
                                <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 ml-2">
                                  {formatTime(conv.last_message_at)}
                                </span>
                              </div>
                              <p className="text-xs text-gray-600 dark:text-gray-400 truncate mb-1">
                                {conv.last_message_preview || '—'}
                              </p>
                              <div className="flex items-center justify-end">
                                {conv.unread_count > 0 && (
                                  <span
                                    className="text-xs font-bold text-white rounded-full px-2 py-0.5"
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
                    })}
                    {hasMoreConversations && (
                      <div className="p-3 text-center text-xs text-gray-400 dark:text-gray-500">
                        Role para ver mais conversas...
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
          </>
          )}

          {/* ── Painel Direito — Mensagens (no mobile: só mostra quando conversa selecionada) ── */}
          {(!isMobile || selectedConversationId) && (
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col bg-gray-50 dark:bg-[#1e1e1e] min-w-0">
            {selectedConversationId && selectedConversation ? (
              <>
                {/* Header da conversa — compacto; etiquetas e ações na mesma linha */}
                <div className="flex-shrink-0 bg-white dark:bg-[#2a2a2a] border-b border-gray-200 dark:border-[#404040]">
                  <div className="px-3 py-2 flex items-center gap-2 min-w-0 flex-wrap">
                    {isMobile && (
                      <button
                        type="button"
                        onClick={() => setSelectedConversationId('')}
                        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-[#333] text-gray-700 dark:text-gray-200 flex-shrink-0"
                        aria-label="Voltar para lista"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                    )}
                    {/* Botão ocultar/mostrar lista de conversas */}
                    {!isMobile && (
                      <button
                        type="button"
                        onClick={() => setConversationsListHidden((v) => !v)}
                        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-[#333] text-gray-600 dark:text-gray-400 flex-shrink-0"
                        title={conversationsListHidden ? 'Mostrar lista de conversas' : 'Ocultar lista de conversas'}
                        aria-label={conversationsListHidden ? 'Mostrar conversas' : 'Ocultar conversas'}
                      >
                        {conversationsListHidden ? (
                          <PanelRightOpen className="w-5 h-5" />
                        ) : (
                          <PanelRightClose className="w-5 h-5" />
                        )}
                      </button>
                    )}
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                      style={{ backgroundColor: getConversationColor(selectedConversation.title) }}
                    >
                      {selectedConversation.is_group ? (
                        <Users className="w-4 h-4" />
                      ) : (
                        <span>{getInitials(selectedConversation.title)}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap gap-y-0.5">
                        <h2 className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
                          {selectedConversation.title}
                        </h2>
                        {selectedChannel?.type === 'whatsapp_official' && (
                          <span
                            className={`flex-shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${
                              isWithin24hWindow(selectedConversation)
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                            }`}
                          >
                            {isWithin24hWindow(selectedConversation) ? '24h' : 'template'}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {convContact !== undefined && (
                          convContact ? (
                            <button
                              onClick={openContactModal}
                              className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline truncate max-w-[120px]"
                            >
                              {convContact.name || 'Contato'}
                            </button>
                          ) : (
                            <button
                              onClick={openContactModal}
                              className="text-[11px] text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-0.5"
                            >
                              <UserPlus className="w-3 h-3" /> Salvar
                            </button>
                          )
                        )}
                        <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                          {selectedConversation.remote_jid}
                        </span>
                      </div>
                    </div>
                    {(userStatus === 'suporte' || userStatus === 'admin' || userStatus === 'super_admin') && (
                      <div ref={tagsPopoverRef} className="relative">
                        <button
                          type="button"
                          onClick={() => setShowTagsPopover((v) => !v)}
                          className="px-2 py-1 text-xs font-medium rounded-md border border-gray-300 dark:border-[#404040] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#333] flex items-center gap-1"
                        >
                          Etiquetas
                          {(selectedConversation.tags || []).length > 0 && (
                            <span className="bg-[#8CD955] text-white rounded-full min-w-[14px] h-3.5 flex items-center justify-center text-[10px] px-1">
                              {(selectedConversation.tags || []).length}
                            </span>
                          )}
                        </button>
                        {showTagsPopover && (
                          <div className="absolute right-0 top-full mt-1 z-20 w-56 py-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-lg shadow-lg">
                            <div className="px-3 py-1 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-[#404040]">
                              Marcar conversa
                            </div>
                            <p className="px-3 py-1 text-[11px] text-gray-400 dark:text-gray-500">
                              Clique para adicionar ou remover.
                            </p>
                            {tagOptions.length === 0 ? (
                              <p className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                                Nenhuma etiqueta. Admin pode criar em Etiquetas Chat.
                              </p>
                            ) : (
                              <>
                                {tagOptions.map((t) => {
                                  const isSelected = (selectedConversation.tags || []).includes(t.name);
                                  const tagColor = t.color ?? '#3b82f6';
                                  return (
                                    <button
                                      key={t.id}
                                      type="button"
                                      onClick={() => handleToggleTag(t.name)}
                                      disabled={updatingTags}
                                      className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-[#333] text-gray-700 dark:text-gray-200"
                                    >
                                      <span
                                        className="w-4 h-4 rounded flex items-center justify-center text-xs flex-shrink-0 text-white font-bold"
                                        style={{ backgroundColor: isSelected ? tagColor : 'transparent', border: `2px solid ${tagColor}` }}
                                      >
                                        {isSelected ? '✓' : ''}
                                      </span>
                                      <span className={isSelected ? 'font-medium' : ''}>{t.name}</span>
                                      {isSelected && (
                                        <span className="ml-auto w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: tagColor }} />
                                      )}
                                    </button>
                                  );
                                })}
                                {(selectedConversation.tags || []).length > 0 && (
                                  <button
                                    type="button"
                                    onClick={handleRemoveAllTags}
                                    disabled={updatingTags}
                                    className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 border-t border-gray-100 dark:border-[#404040] mt-1 pt-2"
                                  >
                                    <X className="w-4 h-4 flex-shrink-0" />
                                    Remover todas as etiquetas
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {selectedConversation.attendance_status === 'resolvido' ? (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Resolvida
                      </span>
                    ) : (userStatus === 'suporte' || userStatus === 'admin' || userStatus === 'super_admin') ? (
                      <button
                        onClick={handleResolveConversation}
                        disabled={resolvingConversation}
                        className="px-2.5 py-1 text-xs font-medium text-white rounded-md flex items-center gap-1.5 disabled:opacity-60"
                        style={{ backgroundColor: '#8CD955' }}
                      >
                        {resolvingConversation ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        )}
                        Resolver
                      </button>
                    ) : null}
                    {/* ── Menu MoreVertical ── */}
                    <div ref={convMenuRef} className="relative">
                      <button
                        type="button"
                        onClick={() => setShowConvMenu((v) => !v)}
                        className="p-1.5 hover:bg-gray-100 dark:hover:bg-[#333] rounded-md text-gray-500 dark:text-gray-400"
                        aria-label="Mais opções"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {showConvMenu && (
                        <div className="absolute right-0 top-full mt-1 z-30 w-52 py-1 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-lg shadow-lg">
                          {selectedConversation.attendance_status === 'resolvido' &&
                            (userStatus === 'suporte' || userStatus === 'admin' || userStatus === 'super_admin') && (
                            <button
                              type="button"
                              onClick={handleReopenConversation}
                              disabled={reopeningConversation}
                              className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-[#333] text-gray-700 dark:text-gray-200 disabled:opacity-60"
                            >
                              {reopeningConversation ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                              Reabrir conversa
                            </button>
                          )}
                          {(userStatus === 'suporte' || userStatus === 'admin' || userStatus === 'super_admin') && (
                            <button
                              type="button"
                              onClick={() => { setShowTagsPopover(true); setShowConvMenu(false); }}
                              className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-[#333] text-gray-700 dark:text-gray-200"
                            >
                              <Tag className="w-4 h-4" />
                              Gerenciar etiquetas
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Área de mensagens — scroll interno */}
                <div
                  ref={messagesContainerRef}
                  className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 space-y-4"
                  onScroll={handleMessagesScroll}
                >
                  {/* Botão / indicador de mensagens mais antigas */}
                  {hasOlderMessages && (
                    <div className="flex justify-center">
                      <button
                        onClick={loadOlderMessages}
                        disabled={loadingOlderMessages}
                        className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors px-3 py-1.5 rounded-full bg-white dark:bg-[#333] border border-gray-200 dark:border-[#404040] shadow-sm"
                      >
                        {loadingOlderMessages ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <ChevronUp className="w-3 h-3" />
                        )}
                        {loadingOlderMessages ? 'Carregando...' : 'Carregar mensagens anteriores'}
                      </button>
                    </div>
                  )}

                  {messagesLoading ? (
                    <div className="flex items-center justify-center gap-2 text-gray-500 dark:text-gray-400 text-sm py-8">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Carregando mensagens...
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="text-center text-gray-500 dark:text-gray-400 text-sm mt-8">
                      Nenhuma mensagem ainda
                    </div>
                  ) : (
                    messages.map((msg, index) => {
                      const showDate =
                        index === 0 ||
                        new Date(msg.timestamp * 1000).toDateString() !==
                          new Date(messages[index - 1].timestamp * 1000).toDateString();
                      const isHovered = hoveredMessageId === msg.id;
                      const isDeleting = deletingMessageId === msg.id;
                      const canDelete = userStatus === 'suporte' || userStatus === 'admin' || userStatus === 'super_admin';

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
                          <div
                            className={`flex ${msg.from_me ? 'justify-end' : 'justify-start'} group`}
                            onMouseEnter={() => setHoveredMessageId(msg.id)}
                            onMouseLeave={() => setHoveredMessageId(null)}
                          >
                            {!msg.from_me && (
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold mr-2 flex-shrink-0"
                                style={{
                                  backgroundColor: getConversationColor(
                                    msg.sender_jid || selectedConversation.title
                                  ),
                                }}
                              >
                                {getInitials(msg.sender_jid || selectedConversation.title)}
                              </div>
                            )}
                            <div className={`flex items-end gap-1 ${msg.from_me ? 'flex-row-reverse' : 'flex-row'}`}>
                              <div
                                className={`max-w-md px-4 py-2 rounded-lg ${
                                  msg.from_me
                                    ? 'bg-[#8CD955] text-white rounded-br-none'
                                    : 'bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 rounded-bl-none border border-gray-200 dark:border-[#404040]'
                                } ${isDeleting ? 'opacity-50' : ''}`}
                              >
                                <MessageContent msg={msg} fromMe={msg.from_me} onMediaClick={(url, type, caption) => setMediaModal({ url, type, caption })} />
                                <div
                                  className={`flex items-center justify-end gap-1 mt-1 ${
                                    msg.from_me ? 'text-white/80' : 'text-gray-500 dark:text-gray-400'
                                  }`}
                                >
                                  <span className="text-xs">{formatMessageTime(msg.timestamp)}</span>
                                  {msg.from_me && getStatusIcon(msg.status)}
                                </div>
                              </div>
                              {/* Botão apagar — aparece no hover */}
                              {canDelete && (isHovered || isDeleting) && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteMessage(msg.id)}
                                  disabled={isDeleting || !!deletingMessageId}
                                  className="flex-shrink-0 mb-1 p-1 rounded-full bg-white dark:bg-[#333] border border-gray-200 dark:border-[#404040] text-gray-400 hover:text-red-500 hover:border-red-300 shadow-sm disabled:opacity-50 transition-colors"
                                  title="Apagar mensagem"
                                >
                                  {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                </button>
                              )}
                            </div>
                          </div>
                        </React.Fragment>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Alerta de erro no envio */}
                {sendError && (
                  <div className="flex-shrink-0 flex items-start gap-3 px-4 py-3 bg-red-500/15 dark:bg-red-500/20 border-t border-red-500/40 text-red-800 dark:text-red-200">
                    <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
                    <p className="text-sm flex-1 min-w-0">{sendError}</p>
                    <button
                      type="button"
                      onClick={() => setSendError(null)}
                      className="p-1.5 rounded-lg hover:bg-red-500/20 transition-colors flex-shrink-0"
                      aria-label="Fechar"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* ── Barra de mensagem ────────────────────────────────── */}
                <div className="flex-shrink-0 w-full bg-white dark:bg-[#2a2a2a] border-t border-gray-200 dark:border-[#404040] px-3 py-3">
                  <input ref={fileInputRef} type="file" className="hidden" accept="image/jpeg,image/png,image/webp,audio/ogg,audio/mpeg,video/mp4,application/pdf" onChange={handleFileSelect} />
                  <input ref={imageInputRef} type="file" className="hidden" accept="image/jpeg,image/png,image/webp" onChange={handleFileSelect} />
                  <input ref={docInputRef} type="file" className="hidden" accept="application/pdf" onChange={handleFileSelect} />
                  {attachedMedia && (
                    <div className="mb-2 p-2 bg-gray-100 dark:bg-[#333] rounded-lg flex items-center gap-2 border border-gray-200 dark:border-[#404040]">
                      {attachedMedia.type === 'image' && attachedMedia.preview && (
                        <img src={attachedMedia.preview} alt="" className="w-10 h-10 rounded object-cover" />
                      )}
                      {attachedMedia.type === 'audio' && <Mic size={20} className="text-green-500" />}
                      {(attachedMedia.type === 'video' || attachedMedia.type === 'document') && (
                        <FileText size={20} className="text-blue-500" />
                      )}
                      <span className="text-xs text-gray-700 dark:text-gray-300 flex-1 truncate">{attachedMedia.name}</span>
                      <button
                        type="button"
                        onClick={() => {
                          if (attachedMedia?.preview) URL.revokeObjectURL(attachedMedia.preview);
                          setAttachedMedia(null);
                        }}
                        className="p-1 rounded text-gray-500 hover:bg-gray-200 dark:hover:bg-[#404040]"
                        aria-label="Remover anexo"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-0.5 mb-2">
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowEmojiPicker((v) => !v)}
                        className={`p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-[#333] transition-colors ${showEmojiPicker ? 'text-[#8CD955]' : 'text-gray-500 dark:text-gray-400'}`}
                        title="Emoji"
                      >
                        <Smile className="w-4 h-4" />
                      </button>
                      {showEmojiPicker && (
                        <EmojiPicker
                          onSelect={(emoji) => {
                            setMessageText((t) => t + emoji);
                            textareaRef.current?.focus();
                          }}
                          onClose={() => setShowEmojiPicker(false)}
                        />
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading || selectedChannel?.type !== 'whatsapp_official' || !canSendFreeMessage}
                      className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#333] disabled:opacity-50"
                      title="Anexar"
                    >
                      {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
                    </button>

                    {/* Microfone / Parar gravação */}
                    {isRecording ? (
                      <>
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50">
                          <div className="flex items-end gap-0.5 h-5" aria-hidden>
                            {recordingLevels.map((level, i) => (
                              <div
                                key={i}
                                className="w-1 min-h-[4px] rounded-full bg-red-500 dark:bg-red-400 transition-all duration-75"
                                style={{ height: `${Math.max(4, level * 20)}px` }}
                              />
                            ))}
                          </div>
                          <span className="text-sm text-red-600 dark:text-red-400 font-medium tabular-nums">
                            {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={stopRecording}
                          disabled={uploading}
                          className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-medium disabled:opacity-50"
                          title="Parar gravação"
                        >
                          <Square className="w-3.5 h-3.5" fill="currentColor" />
                          Parar
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={startRecording}
                        disabled={uploading || selectedChannel?.type !== 'whatsapp_official' || !canSendFreeMessage}
                        className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#333] disabled:opacity-50"
                        title="Gravar áudio"
                      >
                        <Mic className="w-4 h-4" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => docInputRef.current?.click()}
                      disabled={uploading || selectedChannel?.type !== 'whatsapp_official' || !canSendFreeMessage}
                      className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#333] disabled:opacity-50"
                      title="Documento (PDF)"
                    >
                      <FileText className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={uploading || selectedChannel?.type !== 'whatsapp_official' || !canSendFreeMessage}
                      className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#333] disabled:opacity-50"
                      title="Imagem"
                    >
                      <ImageIcon className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="flex-1 min-w-0">
                      <textarea
                        ref={textareaRef}
                        value={messageText}
                        onChange={(e) => {
                          setMessageText(e.target.value);
                          if (textareaRef.current) {
                            textareaRef.current.style.height = 'auto';
                            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                        placeholder={
                          !canSendFreeMessage
                            ? 'Fora da janela 24h. Use template.'
                            : "Digite a mensagem. Shift+Enter = nova linha. '/' = resposta pronta."
                        }
                        rows={2}
                        className="w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-[#404040] rounded-xl bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400 resize-none overflow-y-auto focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] focus:outline-none"
                        style={{ minHeight: '44px', maxHeight: '160px' }}
                        disabled={sending || !canSendFreeMessage}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={handleSpellCheck}
                        disabled={spellChecking || !messageText.trim()}
                        title="Corretor ortográfico"
                        className="px-3 py-2 text-xs font-medium text-white rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-50 min-w-[44px] h-[38px]"
                        style={{ backgroundColor: '#8CD955' }}
                      >
                        {spellChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={handleSendMessage}
                        disabled={(!messageText.trim() && !attachedMedia) || sending || !canSendFreeMessage}
                        title={!canSendFreeMessage ? 'Fora da janela 24h' : 'Enviar'}
                        className="px-3 py-2 text-white rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-50 min-w-[44px] h-[38px]"
                        style={{ backgroundColor: '#8CD955' }}
                      >
                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  {spellCheckBadge && (
                    <p className="mt-1.5 text-[11px] text-center text-gray-500 dark:text-gray-400">
                      {spellCheckBadge === 'fixed' ? '✓ Texto corrigido' : '✓ Sem erros'}
                    </p>
                  )}
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
          )}
        </div>
      </div>

      {/* ── Modal Salvar / Editar Contato ──────────────────────────────────── */}
      {showContactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {convContact ? 'Editar Contato' : 'Salvar Contato'}
              </h3>
              <button
                type="button"
                onClick={() => setShowContactModal(false)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#333] text-gray-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Nome
                </label>
                <input
                  type="text"
                  value={contactForm.name}
                  onChange={(e) => setContactForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Nome do contato"
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Telefone
                </label>
                <input
                  type="text"
                  value={contactForm.phone}
                  onChange={(e) => setContactForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="5511999999999"
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Horário de Atendimento
                </label>
                <select
                  value={contactForm.horario}
                  onChange={(e) => setContactForm((f) => ({ ...f, horario: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] focus:outline-none"
                >
                  <option value="">Selecione um horário</option>
                  <option value="Manhã (08h–12h)">Manhã (08h–12h)</option>
                  <option value="Tarde (12h–18h)">Tarde (12h–18h)</option>
                  <option value="Noite (18h–22h)">Noite (18h–22h)</option>
                  <option value="Comercial (08h–18h)">Comercial (08h–18h)</option>
                  <option value="Qualquer horário">Qualquer horário</option>
                </select>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Melhor horário para entrar em contato com este número
                </p>
              </div>

              {contactSaveError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <p className="text-sm text-red-700 dark:text-red-300">{contactSaveError}</p>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowContactModal(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium border border-gray-300 dark:border-[#404040] rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#333] transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveContact}
                disabled={savingContact}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white rounded-lg flex items-center justify-center gap-2 disabled:opacity-60 transition-colors"
                style={{ backgroundColor: '#8CD955' }}
              >
                {savingContact ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <UserCheck className="w-4 h-4" />
                )}
                {savingContact ? 'Salvando...' : 'Salvar Contato'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
