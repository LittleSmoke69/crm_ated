'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { withTenantSlug } from '@/lib/utils/tenant-href';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Layout from '@/components/Layout';
import Link from '@/components/WhitelabelLink';
import { supabase } from '@/lib/supabase';
import {
  MessageSquare,
  Send,
  CheckCheck,
  BadgeCheck,
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
  Headphones,
  Megaphone,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  RefreshCw,
} from 'lucide-react';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Message {
  id: string;
  message_id?: string | null;
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
  whatsapp_config_id?: string | null;
  provider?: 'evolution' | 'whatsapp_official' | null;
}

interface Conversation {
  id: string;
  remote_jid: string;
  title: string;
  profile_pic_url?: string | null;
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
  /** Instância mestre vinculada à conta — oferecida como canal de atendimento */
  is_master?: boolean;
  is_chat_instance?: boolean;
}

interface ChannelWhatsAppOfficial {
  type: 'whatsapp_official';
  id: string;
  name: string;
  phone_number_id: string;
}

type Channel = ChannelEvolution | ChannelWhatsAppOfficial;
type ConversationFilter = 'mine' | 'unassigned';
type ActiveView = 'chat' | 'contacts' | 'broadcast' | 'agent';

interface BroadcastJob {
  id: string;
  title: string;
  instance_name: string;
  total_count: number;
  current_index: number;
  delay_seconds: number;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  last_error: string | null;
}

interface BroadcastMessage {
  id: string;
  title: string;
  content: string;
  preview: string;
  message_type: 'text_only' | 'audio' | 'ptv' | 'text_with_attachment';
  attachment_url?: string | null;
  has_attachment: boolean;
}

interface BroadcastContact {
  phone: string;
  name?: string;
}

interface FlowOption {
  id: string;
  name: string;
  description?: string;
  status: string;
}

interface InstanceFlowConfig {
  id: string;
  instance_id: string;
  is_active: boolean;
  flows: { id: string; name: string; description?: string; status: string } | null;
}

interface CrmSnapshot {
  kind?: string;
  status?: string | null;
  banca_name?: string | null;
  crm_banca_id?: string | null;
  temperature?: string | null;
  total_depositado?: number | null;
  total_apostado?: number | null;
  last_interaction?: string | null;
  tag_labels?: string[];
  transferred_at?: string | null;
  transfer_deadline_days?: number | null;
  /** ISO — fim do prazo (transferred_at + dias). */
  transfer_expires_at?: string | null;
}

function formatTransferExpiryDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface ChatContact {
  id: string;
  name?: string | null;
  telefone: string;
  horario?: string | null;
  crm_sync_kind?: string | null;
  crm_external_id?: string | null;
  crm_snapshot?: CrmSnapshot | null;
  is_pinned_manual?: boolean | null;
  updated_at?: string | null;
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

// ─── MediaRetryButton (retry download de mídia pendente) ─────────────────────

function MediaRetryButton({
  chatMessageId,
  mediaType,
  fromMe,
  onResolved,
}: {
  chatMessageId: string;
  mediaType: string;
  fromMe: boolean;
  onResolved: (url: string) => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const icons: Record<string, string> = { audio: '🎵', image: '📷', video: '🎬', document: '📄' };
  const labels: Record<string, string> = { audio: 'Áudio', image: 'Imagem', video: 'Vídeo', document: 'Documento' };

  const handleRetry = async () => {
    setRetrying(true);
    setError(null);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') || '' : '';
      const res = await fetch('/api/chat/messages/retry-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ chat_message_id: chatMessageId }),
      });
      const json = await res.json();
      if (json.success && json.data?.media_url) {
        onResolved(json.data.media_url);
      } else {
        setError(json.error || json.message || 'Não foi possível recuperar');
      }
    } catch {
      setError('Erro de conexão');
    } finally {
      setRetrying(false);
    }
  };

  const textClass = fromMe ? 'text-white/70' : 'text-gray-500 dark:text-gray-400';
  const btnClass = fromMe
    ? 'bg-white/20 hover:bg-white/30 text-white'
    : 'bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200';

  return (
    <div className="flex flex-col gap-1.5 min-w-[200px] max-w-[280px]">
      <div className="flex items-center gap-2">
        <span className="text-lg">{icons[mediaType] || '📎'}</span>
        <span className={`text-sm italic ${textClass}`}>{labels[mediaType] || 'Mídia'} não carregado</span>
      </div>
      <button
        type="button"
        onClick={handleRetry}
        disabled={retrying}
        className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${btnClass} disabled:opacity-50`}
      >
        {retrying ? 'Recuperando…' : 'Tentar baixar novamente'}
      </button>
      {error && <span className={`text-xs ${textClass}`}>{error}</span>}
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
  onMediaResolved,
}: {
  msg: Message;
  fromMe: boolean;
  onMediaClick: (url: string, type: 'image' | 'video', caption?: string | null) => void;
  onMediaResolved?: (messageId: string, url: string) => void;
}) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [autoRetried, setAutoRetried] = useState(false);
  const mediaUrl = resolvedUrl || msg.media_url;
  const textClass = fromMe ? 'text-white/90' : 'text-gray-600 dark:text-gray-300';

  const handleMediaResolved = (url: string) => {
    setResolvedUrl(url);
    onMediaResolved?.(msg.id, url);
  };

  useEffect(() => {
    if (mediaUrl || autoRetried) return;
    if (msg.provider !== 'whatsapp_official') return;
    if (!msg.media_type || msg.media_type === 'text') return;

    const timer = setTimeout(async () => {
      setAutoRetried(true);
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') || '' : '';
        const res = await fetch('/api/chat/messages/retry-media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ chat_message_id: msg.id }),
        });
        const json = await res.json();
        if (json.success && json.data?.media_url) {
          handleMediaResolved(json.data.media_url);
        }
      } catch {
        // silencioso — o botão de retry manual continua disponível
      }
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaUrl, autoRetried, msg.id, msg.provider, msg.media_type]);

  const canRetry = msg.provider === 'whatsapp_official';

  const retryFallback = (mediaType: string) =>
    canRetry ? (
      <MediaRetryButton
        chatMessageId={msg.id}
        mediaType={mediaType}
        fromMe={fromMe}
        onResolved={handleMediaResolved}
      />
    ) : null;

  return (
    <div className="space-y-1">
      {msg.media_type === 'image' && (
        mediaUrl ? (
          <img
            src={mediaUrl}
            alt={msg.caption ?? 'imagem'}
            className="rounded-lg max-w-xs max-h-64 object-cover cursor-pointer"
            onClick={() => onMediaClick(mediaUrl, 'image', msg.caption)}
          />
        ) : (
          retryFallback('image') || <span className={`text-sm italic ${textClass}`}>📷 Imagem não disponível</span>
        )
      )}
      {msg.media_type === 'audio' && (
        mediaUrl ? (
          <AudioMessagePlayer src={mediaUrl} fromMe={fromMe} />
        ) : (
          retryFallback('audio') || <span className={`text-sm italic ${textClass}`}>🎵 Áudio não disponível</span>
        )
      )}
      {msg.media_type === 'video' && (
        mediaUrl ? (
          <div className="relative cursor-pointer group max-w-xs" onClick={() => onMediaClick(mediaUrl, 'video', msg.caption)}>
            <video src={mediaUrl} className="rounded-lg max-w-xs max-h-64 pointer-events-none" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-lg group-hover:bg-black/50 transition-colors">
              <div className="w-12 h-12 bg-white/90 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-gray-800 ml-1" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
          </div>
        ) : (
          retryFallback('video') || <span className={`text-sm italic ${textClass}`}>🎬 Vídeo não disponível</span>
        )
      )}
      {msg.media_type === 'document' && (
        mediaUrl ? (
          <a
            href={mediaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-2 text-sm underline ${fromMe ? 'text-white/90' : 'text-blue-400'}`}
          >
            <FileText size={16} /> {msg.caption ?? 'Documento'}
          </a>
        ) : (
          retryFallback('document') || <span className={`text-sm italic ${textClass}`}>📄 Documento não disponível</span>
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
/** Cache local do histórico por conversa (sessionStorage) — reabrir sem depender só da rede */
const MESSAGES_SESSION_CACHE_PREFIX = 'zaploto_atendimento_msgs_v1';
const MESSAGES_SESSION_CACHE_MAX = 500;

/** Alinhado a app/api/chat/send — instância Evolution indisponível ao enviar. */
const EVOLUTION_INSTANCE_UNREACHABLE_CODE = 'EVOLUTION_INSTANCE_UNREACHABLE';

type EvolutionSendApiResult = {
  success?: boolean;
  error?: string;
  message?: string;
  code?: string;
  data?: unknown;
};

function messageTimestampMs(m: Message): number {
  const t = m.timestamp;
  if (typeof t === 'string') return parseInt(t, 10) * 1000;
  return t > 1e12 ? t : t * 1000;
}

function sortMessagesChronological(list: Message[]): Message[] {
  return [...list].sort((a, b) => messageTimestampMs(a) - messageTimestampMs(b));
}

function readMessagesFromSessionCache(userId: string, conversationId: string): Message[] | null {
  if (typeof window === 'undefined' || !userId) return null;
  try {
    const raw = sessionStorage.getItem(`${MESSAGES_SESSION_CACHE_PREFIX}_${userId}_${conversationId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Message[];
    return Array.isArray(parsed) ? sortMessagesChronological(parsed) : null;
  } catch {
    return null;
  }
}

function writeMessagesToSessionCache(userId: string, conversationId: string, messages: Message[]) {
  if (typeof window === 'undefined' || messages.length === 0 || !userId) return;
  try {
    const sorted = sortMessagesChronological(messages);
    const capped =
      sorted.length > MESSAGES_SESSION_CACHE_MAX
        ? sorted.slice(sorted.length - MESSAGES_SESSION_CACHE_MAX)
        : sorted;
    sessionStorage.setItem(
      `${MESSAGES_SESSION_CACHE_PREFIX}_${userId}_${conversationId}`,
      JSON.stringify(capped)
    );
  } catch (e) {
    console.warn('[Chat Atendimento] Não foi possível gravar cache de mensagens:', e);
  }
}

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
  const [channelsLoading, setChannelsLoading] = useState(true);
  /** Só entra no chat após o usuário confirmar qual instância/canal vai usar no atendimento */
  const [atendimentoGatePassed, setAtendimentoGatePassed] = useState(false);
  /** Aviso na tela de seleção de instância (ex.: instância caiu durante o envio). */
  const [atendimentoGateNotice, setAtendimentoGateNotice] = useState<string | null>(null);
  const [pendingAtendimentoChannel, setPendingAtendimentoChannel] = useState<Channel | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  /** Gate: gerente — vínculos instância ↔ consultor (atendimento_chat_assignments) */
  const [gerenteGateAssignmentByInstance, setGerenteGateAssignmentByInstance] = useState<
    Record<
      string,
      {
        id: string;
        consultor_user_ids: string[];
        consultor_name: string | null;
        crm_banca_id: string | null;
        crm_banca_name?: string | null;
      }
    >
  >({});
  const [gerenteGateBancas, setGerenteGateBancas] = useState<{ id?: string; name: string; url: string | null }[]>([]);
  const [gerenteGateConsultoresByBanca, setGerenteGateConsultoresByBanca] = useState<
    Record<string, { id: string; full_name?: string | null; email?: string | null }[]>
  >({});
  /** Seleção local de consultores por instância; persistida de uma vez ao clicar em «Entrar». */
  const [gerenteGateConsultoresDraftByInstance, setGerenteGateConsultoresDraftByInstance] = useState<
    Record<string, string[]>
  >({});
  const [gerenteGateSavingInstanceId, setGerenteGateSavingInstanceId] = useState<string | null>(null);

  // Conversas
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string>('');
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [visibleConversationsCount, setVisibleConversationsCount] = useState(CONVERSATIONS_PAGE_SIZE);
  const [searchTerm, setSearchTerm] = useState('');
  const [conversationFilter, setConversationFilter] = useState<ConversationFilter>('mine');
  const [tagFilter, setTagFilter] = useState<string>(''); // nome da etiqueta para filtrar (vazio = todas)
  const [tagOptions, setTagOptions] = useState<{ id: string; name: string }[]>([]);
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
    mimetype?: string;
    preview?: string;
    meta_id?: string; // ID do upload direto na Meta (para áudio gravado)
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Cache de conversas por canal — permite exibição imediata ao trocar de canal
  const conversationsCacheRef = useRef<Record<string, Conversation[]>>({});
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
  const [showStartConversationModal, setShowStartConversationModal] = useState(false);
  const [startConversationPhone, setStartConversationPhone] = useState('');
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [startConversationError, setStartConversationError] = useState<string | null>(null);
  const [showResolveMenu, setShowResolveMenu] = useState(false);
  const [showConversationMenu, setShowConversationMenu] = useState(false);
  const [resolvingConversation, setResolvingConversation] = useState(false);
  const [closingConversationId, setClosingConversationId] = useState<string | null>(null);
  const [showTagsPopover, setShowTagsPopover] = useState(false);
  const tagsPopoverRef = useRef<HTMLDivElement>(null);
  const conversationMenuRef = useRef<HTMLDivElement>(null);
  const [updatingTags, setUpdatingTags] = useState(false);
  const [spellChecking, setSpellChecking] = useState(false);
  const [spellCheckBadge, setSpellCheckBadge] = useState<'fixed' | 'ok' | null>(null);

  // Navegação
  const [activeView, setActiveView] = useState<ActiveView>('chat');
  const [isMobile, setIsMobile] = useState(false);
  const [chatSidebarOpen, setChatSidebarOpen] = useState(false);
  const [conversationsListHidden, setConversationsListHidden] = useState(false);

  // Disparo em Massa
  const [broadcasts, setBroadcasts] = useState<BroadcastJob[]>([]);
  const [broadcastsLoading, setBroadcastsLoading] = useState(false);
  const [showBroadcastForm, setShowBroadcastForm] = useState(false);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastDelay, setBroadcastDelay] = useState(120);
  const [broadcastCreating, setBroadcastCreating] = useState(false);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);
  // Templates de mensagem
  const [broadcastMessages, setBroadcastMessages] = useState<BroadcastMessage[]>([]);
  const [broadcastMessagesLoading, setBroadcastMessagesLoading] = useState(false);
  const [broadcastSelectedMsgId, setBroadcastSelectedMsgId] = useState('');
  // Contatos via CSV
  const [broadcastContacts, setBroadcastContacts] = useState<BroadcastContact[]>([]);
  const [broadcastContactsFileName, setBroadcastContactsFileName] = useState('');
  const broadcastFileInputRef = useRef<HTMLInputElement>(null);
  // Runner (execução em tempo real)
  const broadcastRunnerRef = useRef<{ stop: boolean }>({ stop: false });
  const [activeBroadcastJobId, setActiveBroadcastJobId] = useState<string | null>(null);
  const [activeBroadcastProgress, setActiveBroadcastProgress] = useState<{
    current: number; total: number; contact?: BroadcastContact; lastSent?: BroadcastContact;
  } | null>(null);
  const [activeBroadcastCountdown, setActiveBroadcastCountdown] = useState(0);
  const [broadcastInstanceDown, setBroadcastInstanceDown] = useState(false);

  // Agente de IA
  const [instanceFlowConfig, setInstanceFlowConfig] = useState<InstanceFlowConfig | null | undefined>(undefined);
  const [instanceFlowLoading, setInstanceFlowLoading] = useState(false);
  const [availableFlows, setAvailableFlows] = useState<FlowOption[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState<string>('');
  const [savingFlowConfig, setSavingFlowConfig] = useState(false);
  const [flowConfigError, setFlowConfigError] = useState<string | null>(null);

  // Contatos
  // undefined = não verificado ainda; null = não existe; ChatContact = existe
  const [convContact, setConvContact] = useState<ChatContact | null | undefined>(undefined);
  const [showContactModal, setShowContactModal] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', phone: '', horario: '' });
  const [savingContact, setSavingContact] = useState(false);
  const [contactSaveError, setContactSaveError] = useState<string | null>(null);
  /** Lista unificada (CRM kanban + transferidos + manuais) — consultores */
  const [chatContactsList, setChatContactsList] = useState<ChatContact[]>([]);
  const [chatContactsLoading, setChatContactsLoading] = useState(false);
  /** Filtro da lista na vista Contatos (CRM): todos, só funil ou só transferidos. */
  const [chatContactsKindFilter, setChatContactsKindFilter] = useState<'all' | 'kanban' | 'transferred'>('all');
  const [crmSyncLoading, setCrmSyncLoading] = useState(false);
  const [crmSyncMessage, setCrmSyncMessage] = useState<string | null>(null);

  const chatContactsFiltered = useMemo(() => {
    if (chatContactsKindFilter === 'all') return chatContactsList;
    if (chatContactsKindFilter === 'kanban') {
      return chatContactsList.filter((c) => (c.crm_sync_kind || 'manual') === 'kanban');
    }
    return chatContactsList.filter((c) => c.crm_sync_kind === 'transferred');
  }, [chatContactsList, chatContactsKindFilter]);

  const authHeaders = (): Record<string, string> => (userId ? { 'X-User-Id': userId } : {});

  const loadGerenteGateAtendimento = useCallback(async () => {
    if (!userId || userStatus !== 'gerente') return;
    try {
      const h = { ...authHeaders(), credentials: 'include' as const };
      const [r1, rBancas] = await Promise.all([
        fetch('/api/gerente/atendimento-chat/instances', { headers: h }),
        fetch('/api/user/bancas', { headers: h }),
      ]);
      const j1 = await r1.json();
      const jB = await rBancas.json();
      const map: Record<
        string,
        {
          id: string;
          consultor_user_ids: string[];
          consultor_name: string | null;
          crm_banca_id: string | null;
          crm_banca_name?: string | null;
        }
      > = {};
      if (j1.success && Array.isArray(j1.data)) {
        for (const row of j1.data) {
          const iid = row.evolution_instance_id as string | undefined;
          if (!iid) continue;
          const rawIds = row.consultor_user_ids;
          const consultor_user_ids = Array.isArray(rawIds)
            ? [...new Set(rawIds.map((x: string) => String(x).trim()).filter(Boolean))]
            : [];
          map[iid] = {
            id: row.id,
            consultor_user_ids,
            consultor_name: row.consultor_name ?? null,
            crm_banca_id: row.crm_banca_id ?? null,
            crm_banca_name: row.crm_banca_name ?? null,
          };
        }
      }
      setGerenteGateAssignmentByInstance(map);
      const draftFromServer: Record<string, string[]> = {};
      for (const [iid, row] of Object.entries(map)) {
        draftFromServer[iid] = [...row.consultor_user_ids];
      }
      setGerenteGateConsultoresDraftByInstance(draftFromServer);
      if (jB.success && Array.isArray(jB.data)) {
        setGerenteGateBancas(
          jB.data.filter((b: { id?: string }) => !!b?.id).map((b: { id: string; name: string; url: string | null }) => b)
        );
      } else {
        setGerenteGateBancas([]);
      }

      const bancaIdsToLoad = new Set<string>();
      for (const row of Object.values(map)) {
        if (row.crm_banca_id) bancaIdsToLoad.add(row.crm_banca_id);
      }
      if (bancaIdsToLoad.size === 0) {
        setGerenteGateConsultoresByBanca({});
      } else {
        const entries = await Promise.all(
          [...bancaIdsToLoad].map(async (bid) => {
            const r = await fetch(`/api/gerente/consultores?banca_id=${encodeURIComponent(bid)}`, { headers: h });
            const j = await r.json();
            const list =
              j.success && Array.isArray(j.data)
                ? j.data.map((c: { id: string; full_name?: string; email?: string }) => ({
                    id: c.id,
                    full_name: c.full_name,
                    email: c.email,
                  }))
                : [];
            return [bid, list] as const;
          })
        );
        setGerenteGateConsultoresByBanca(Object.fromEntries(entries));
      }
    } catch {
      /* ignore */
    }
  }, [userId, userStatus]);

  const persistGerenteGateConsultores = useCallback(
    async (
      instanceId: string,
      assignmentId: string | null | undefined,
      consultorUserIds: string[],
      crmBancaId: string | null | undefined
    ): Promise<boolean> => {
      if (!userId || userStatus !== 'gerente') return false;
      if (!crmBancaId) {
        setAtendimentoGateNotice('Selecione uma banca antes de escolher os consultores.');
        return false;
      }
      setGerenteGateSavingInstanceId(instanceId);
      setAtendimentoGateNotice(null);
      try {
        const headers: Record<string, string> = { ...authHeaders(), 'Content-Type': 'application/json' };
        const fetchOpts: RequestInit = { headers, credentials: 'include' };
        if (assignmentId) {
          const res = await fetch(`/api/gerente/atendimento-chat/instances/${assignmentId}`, {
            ...fetchOpts,
            method: 'PATCH',
            body: JSON.stringify({ consultor_user_ids: consultorUserIds }),
          });
          const j = await res.json();
          if (!res.ok || !j.success) {
            setAtendimentoGateNotice(j.error || 'Não foi possível atualizar os consultores.');
            return false;
          }
        } else {
          const res = await fetch('/api/gerente/atendimento-chat/instances', {
            ...fetchOpts,
            method: 'POST',
            body: JSON.stringify({
              link_existing: true,
              evolution_instance_id: instanceId,
              crm_banca_id: crmBancaId,
              consultor_user_ids: consultorUserIds,
            }),
          });
          const j = await res.json();
          if (!res.ok || !j.success) {
            setAtendimentoGateNotice(j.error || 'Não foi possível registrar o vínculo de atendimento.');
            return false;
          }
        }
        await loadGerenteGateAtendimento();
        return true;
      } catch {
        setAtendimentoGateNotice('Falha de rede ao salvar consultores.');
        return false;
      } finally {
        setGerenteGateSavingInstanceId(null);
      }
    },
    [userId, userStatus, loadGerenteGateAtendimento]
  );

  const handleGerenteGateBancaChange = useCallback(
    async (instanceId: string, assignmentId: string | null | undefined, crmBancaId: string | null) => {
      if (!userId || userStatus !== 'gerente') return;
      if (!assignmentId && !crmBancaId) return;
      setGerenteGateSavingInstanceId(instanceId);
      setAtendimentoGateNotice(null);
      try {
        const headers: Record<string, string> = { ...authHeaders(), 'Content-Type': 'application/json' };
        const fetchOpts: RequestInit = { headers, credentials: 'include' };
        if (assignmentId) {
          const res = await fetch(`/api/gerente/atendimento-chat/instances/${assignmentId}`, {
            ...fetchOpts,
            method: 'PATCH',
            body: JSON.stringify({ crm_banca_id: crmBancaId }),
          });
          const j = await res.json();
          if (!res.ok || !j.success) {
            setAtendimentoGateNotice(j.error || 'Não foi possível atualizar a banca.');
            return;
          }
        } else if (crmBancaId) {
          const res = await fetch('/api/gerente/atendimento-chat/instances', {
            ...fetchOpts,
            method: 'POST',
            body: JSON.stringify({
              link_existing: true,
              evolution_instance_id: instanceId,
              crm_banca_id: crmBancaId,
              consultor_user_ids: [],
            }),
          });
          const j = await res.json();
          if (!res.ok || !j.success) {
            setAtendimentoGateNotice(j.error || 'Não foi possível registrar o vínculo com a banca.');
            return;
          }
        }
        await loadGerenteGateAtendimento();
      } finally {
        setGerenteGateSavingInstanceId(null);
      }
    },
    [userId, userStatus, loadGerenteGateAtendimento]
  );

  useEffect(() => {
    if (atendimentoGatePassed || userStatus !== 'gerente' || !userId) return;
    loadGerenteGateAtendimento();
  }, [atendimentoGatePassed, userStatus, userId, loadGerenteGateAtendimento]);

  const canSelectChannel =
    userStatus === 'super_admin' ||
    userStatus === 'admin' ||
    userStatus === 'suporte' ||
    userStatus === 'gerente' ||
    userStatus === 'consultor';

  /** Lista Contatos + sync CRM (kanban / transferidos) — consultor e gerente */
  const crmChatContactsUser =
    userStatus === 'consultor' || userStatus === 'gerente';

  const refreshChatContacts = useCallback(async () => {
    if (!userId || !crmChatContactsUser) return;
    setChatContactsLoading(true);
    try {
      const r = await fetch('/api/chat/contacts?list=1', { headers: { 'X-User-Id': userId } });
      const j = await r.json();
      if (j.success && Array.isArray(j.data)) setChatContactsList(j.data as ChatContact[]);
    } finally {
      setChatContactsLoading(false);
    }
  }, [userId, crmChatContactsUser]);

  const syncCrmNow = useCallback(async () => {
    if (!userId || !crmChatContactsUser) return;
    setCrmSyncLoading(true);
    setCrmSyncMessage(null);
    try {
      const r = await fetch('/api/chat/contacts/sync-from-crm', {
        method: 'POST',
        headers: { 'X-User-Id': userId },
      });
      const j = await r.json();
      if (!j.success) setCrmSyncMessage(j.error || 'Falha na sincronização CRM');
      await refreshChatContacts();
    } catch {
      setCrmSyncMessage('Falha de rede ao sincronizar CRM.');
    } finally {
      setCrmSyncLoading(false);
    }
  }, [userId, crmChatContactsUser, refreshChatContacts]);

  const openContactRow = useCallback(
    (telefone: string) => {
      const phone = String(telefone || '').replace(/\D/g, '');
      if (!phone) return;
      const conv = conversations.find(
        (c) =>
          !c.is_group &&
          c.remote_jid.replace(/@s\.whatsapp\.net$/, '').replace(/\D/g, '') === phone
      );
      if (conv) {
        setActiveView('chat');
        setSelectedConversationId(conv.id);
        return;
      }
      setStartConversationPhone(phone);
      setShowStartConversationModal(true);
      setActiveView('chat');
    },
    [conversations]
  );

  const CRM_CHAT_SYNC_THROTTLE_MS = 5 * 60 * 1000;

  useEffect(() => {
    if (activeView !== 'contacts' || !crmChatContactsUser || !userId) return;
    let cancelled = false;
    (async () => {
      await refreshChatContacts();
      if (cancelled) return;
      if (typeof window === 'undefined') return;
      const key = 'zaploto_chat_crm_sync_ts';
      const last = parseInt(sessionStorage.getItem(key) || '0', 10);
      const now = Date.now();
      if (now - last < CRM_CHAT_SYNC_THROTTLE_MS) return;
      sessionStorage.setItem(key, String(now));
      setCrmSyncLoading(true);
      setCrmSyncMessage(null);
      try {
        const r = await fetch('/api/chat/contacts/sync-from-crm', {
          method: 'POST',
          headers: { 'X-User-Id': userId },
        });
        const j = await r.json();
        if (!j.success && !cancelled) setCrmSyncMessage(j.error || 'Sincronização CRM incompleta');
        if (!cancelled) await refreshChatContacts();
      } catch {
        if (!cancelled) setCrmSyncMessage('Falha ao sincronizar com o CRM.');
      } finally {
        if (!cancelled) setCrmSyncLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeView, userId, crmChatContactsUser, refreshChatContacts]);

  const handleSignOut = async () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
    }
    window.location.href = withTenantSlug('/login');
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
    setChannelsLoading(true);
    fetch('/api/chat/channels', { headers: authHeaders() })
      .then((r) => r.json())
      .then((result) => {
        if (result.success && result.data) {
          const evo: ChannelEvolution[] = result.data.evolution || [];
          // Chat-atendimento usa exclusivamente Evolution — WhatsApp Oficial fica no /chat
          setChannels({ evolution: evo, whatsapp_official: [] });
          const firstChannel: Channel | null = evo.length > 0 ? evo[0] : null;
          // Pré-seleção na tela de instância (antes de abrir o chat); não define selectedChannel aqui
          setPendingAtendimentoChannel((prev) => prev ?? firstChannel);
          // Pré-carrega conversas de todas as instâncias Evolution em paralelo
          const allChannels: Array<{ id: string; type: 'evolution' | 'whatsapp_official' }> = [
            ...evo.map((c) => ({ id: c.id, type: 'evolution' as const })),
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
      .catch((e) => console.error('[Chat] canais:', e))
      .finally(() => setChannelsLoading(false));
  }, [userId]);

  /** Enquanto o gate está aberto, sincroniza contatos/chats via Evolution API (servidor) para o canal Evolution em foco. */
  const pendingEvolutionInstanceIdForGate =
    !atendimentoGatePassed && pendingAtendimentoChannel?.type === 'evolution'
      ? pendingAtendimentoChannel.id
      : null;

  useEffect(() => {
    if (!userId || channelsLoading || !pendingEvolutionInstanceIdForGate) return;
    const params = `instance_id=${pendingEvolutionInstanceIdForGate}`;
    fetch(`/api/chat/conversations?${params}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          conversationsCacheRef.current[pendingEvolutionInstanceIdForGate] = res.data;
        }
        const meta = res.meta as { evolution_directory_sync?: string; evolution_sync_error?: string } | undefined;
        if (meta?.evolution_directory_sync === 'error' && meta.evolution_sync_error) {
          console.warn('[Chat Atendimento] Sincronização Evolution:', meta.evolution_sync_error);
        }
      })
      .catch(() => {});
  }, [userId, channelsLoading, pendingEvolutionInstanceIdForGate]);

  const channelPickerKey = (c: Channel) => `${c.type}:${c.id}`;

  const openAtendimentoWithPendingChannel = async () => {
    if (!pendingAtendimentoChannel) return;
    setAtendimentoGateNotice(null);
    if (userStatus === 'gerente' && pendingAtendimentoChannel.type === 'evolution') {
      const instId = pendingAtendimentoChannel.id;
      const gRow = gerenteGateAssignmentByInstance[instId];
      if (!gRow?.crm_banca_id) {
        setAtendimentoGateNotice('Selecione a banca (CRM) desta instância antes de entrar.');
        return;
      }
      const draftIds =
        gerenteGateConsultoresDraftByInstance[instId] ?? gRow.consultor_user_ids ?? [];
      const ok = await persistGerenteGateConsultores(instId, gRow.id, draftIds, gRow.crm_banca_id);
      if (!ok) return;
    }
    setSelectedChannel(pendingAtendimentoChannel);
    setAtendimentoGatePassed(true);
    setSelectedConversationId('');
    setChatSidebarOpen(true);
  };

  const reopenAtendimentoInstancePicker = () => {
    setAtendimentoGateNotice(null);
    setPendingAtendimentoChannel((prev) => selectedChannel ?? prev);
    setAtendimentoGatePassed(false);
    setSelectedChannel(null);
    setSelectedConversationId('');
    setConversations([]);
    setMessages([]);
  };

  /** Volta ao seletor mantendo aviso (ex.: instância desconectada). */
  const reopenAtendimentoInstancePickerWithNotice = (notice: string) => {
    setPendingAtendimentoChannel((prev) => selectedChannel ?? prev);
    setAtendimentoGatePassed(false);
    setSelectedChannel(null);
    setSelectedConversationId('');
    setConversations([]);
    setMessages([]);
    setSendError(null);
    setAtendimentoGateNotice(notice);
  };

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
          const meta = result.meta as { evolution_directory_sync?: string; evolution_sync_error?: string } | undefined;
          if (meta?.evolution_directory_sync === 'error' && meta.evolution_sync_error) {
            console.warn('[Chat Atendimento] Sincronização Evolution:', meta.evolution_sync_error);
          }
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

  useEffect(() => {
    if (!selectedChannel) return;
    loadConversationsFromApi(false);
  }, [selectedChannel, loadConversationsFromApi]);

  // Reprocessa eventos pendentes de webhook a cada 5 minutos
  // para garantir que mensagens faltantes sejam persistidas em chat_messages.
  const processPendingWebhookEvents = useCallback(async () => {
    if (!selectedChannel) return;

    try {
      if (selectedChannel.type === 'evolution') {
        const res = await fetch('/api/chat/evolution-events/process-pending', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            instance_name: selectedChannel.instance_name,
            limit: 200,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (json?.success && Number(json?.data?.processed || 0) > 0) {
          await loadConversationsFromApi(true);
        }
        return;
      }

      const res = await fetch('/api/chat/webhook-events/process-pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ limit: 200 }),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.success && Number(json?.data?.processed || 0) > 0) {
        await loadConversationsFromApi(true);
      }
    } catch (error) {
      console.error('[Chat Atendimento] processPendingWebhookEvents:', error);
    }
  }, [selectedChannel, loadConversationsFromApi, userId]);

  useEffect(() => {
    if (!selectedChannel || !atendimentoGatePassed) return;

    // Executa uma vez ao entrar no atendimento e depois a cada 5 minutos.
    processPendingWebhookEvents();
    const intervalId = window.setInterval(processPendingWebhookEvents, 5 * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [selectedChannel, atendimentoGatePassed, processPendingWebhookEvents]);

  // Etiquetas disponíveis (criadas pelo admin) para filtro e para marcar conversas
  useEffect(() => {
    if (
      !userId ||
      !(
        userStatus === 'suporte' ||
        userStatus === 'admin' ||
        userStatus === 'super_admin' ||
        userStatus === 'gerente' ||
        userStatus === 'consultor'
      )
    )
      return;
    fetch('/api/chat/tags', { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && Array.isArray(data.data)) {
          setTagOptions(data.data.map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })));
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
      if (
        userStatus === 'suporte' ||
        userStatus === 'admin' ||
        userStatus === 'super_admin' ||
        userStatus === 'gerente' ||
        userStatus === 'consultor'
      ) {
        fetch('/api/chat/tags', { headers: authHeaders() })
          .then((r) => r.json())
          .then((data) => {
            if (data.success && Array.isArray(data.data)) {
              setTagOptions(data.data.map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })));
            }
          })
          .catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [selectedChannel, loadConversationsFromApi, userStatus]);

  // ── Carregar Broadcasts ────────────────────────────────────────────────────
  const loadBroadcasts = useCallback(async () => {
    setBroadcastsLoading(true);
    try {
      const res = await fetch('/api/chat/broadcast', { headers: authHeaders() });
      const result = await res.json();
      if (result.success) setBroadcasts(result.data ?? []);
    } catch { /* silent */ } finally {
      setBroadcastsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const loadBroadcastMessages = useCallback(async () => {
    setBroadcastMessagesLoading(true);
    try {
      const res = await fetch('/api/crm/messages', { headers: authHeaders() });
      const result = await res.json();
      if (result.success) setBroadcastMessages(result.data ?? []);
    } catch { /* silent */ } finally {
      setBroadcastMessagesLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (activeView === 'broadcast') {
      loadBroadcasts();
      loadBroadcastMessages();
    }
  }, [activeView, loadBroadcasts, loadBroadcastMessages]);

  useEffect(() => {
    if (selectedChannel?.type === 'evolution') {
      loadBroadcasts();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChannel]);

  useEffect(() => {
    if (!selectedChannel || selectedChannel.type !== 'evolution' || activeBroadcastJobId) return;
    const running = broadcasts.find((b) => b.status === 'running');
    if (running) {
      startBroadcastRunner(running.id, running.delay_seconds || 120);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcasts, selectedChannel]);

  // ── CSV Parser para contatos ───────────────────────────────────────────────
  const parseBroadcastCSV = (raw: string): BroadcastContact[] => {
    const firstLine = raw.split(/\r?\n/)[0] || '';
    const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];
    const header = lines[0].split(delimiter).map((h) => h.trim().toLowerCase());
    const phoneCandidates = ['telefone', 'phone', 'phone_number', 'number', 'celular', 'mobile', 'whatsapp', 'tel', 'fone'];
    const nameCandidates = ['name', 'nome', 'full_name', 'fullname', 'contact_name', 'contact'];
    const telIdx = header.findIndex((h) => phoneCandidates.includes(h));
    const nameIdx = header.findIndex((h) => nameCandidates.includes(h));
    // Se não tem header reconhecido, trata primeira coluna como telefone
    const phoneCol = telIdx >= 0 ? telIdx : 0;
    const nameCol = nameIdx >= 0 ? nameIdx : (phoneCol === 0 ? 1 : 0);
    const start = telIdx >= 0 ? 1 : 0; // com header reconhecido, pula linha 0
    const result: BroadcastContact[] = [];
    for (let i = start; i < lines.length; i++) {
      const cols = lines[i].split(delimiter);
      const rawPhone = (cols[phoneCol] || '').replace(/\D/g, '');
      if (rawPhone.length < 8) continue;
      result.push({ phone: rawPhone, name: cols[nameCol]?.trim() || undefined });
    }
    return result;
  };

  const handleBroadcastFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBroadcastContactsFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseBroadcastCSV(text);
      setBroadcastContacts(parsed);
      if (parsed.length === 0) setBroadcastError('Nenhum contato válido encontrado no arquivo.');
      else setBroadcastError(null);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ── Runner do Disparo (loop cliente) ──────────────────────────────────────
  const startBroadcastRunner = useCallback(async (jobId: string, delaySeconds: number) => {
    broadcastRunnerRef.current.stop = false;
    setBroadcastInstanceDown(false);
    setActiveBroadcastJobId(jobId);
    setActiveBroadcastProgress(null);
    setActiveBroadcastCountdown(0);

    const run = async (): Promise<void> => {
      if (broadcastRunnerRef.current.stop) return;
      let result: Record<string, unknown>;
      try {
        const res = await fetch(`/api/chat/broadcast/${jobId}/process-next`, {
          method: 'POST',
          headers: authHeaders(),
        });
        result = await res.json();
      } catch {
        // Rede offline — para o runner
        setBroadcastInstanceDown(true);
        setActiveBroadcastJobId(null);
        loadBroadcasts();
        return;
      }

      const data = result.data as {
        done?: boolean; paused?: boolean; instanceDown?: boolean; skipped?: boolean;
        current_index?: number; total_count?: number;
        contact?: BroadcastContact; success?: boolean;
      };

      if (!result.success || data?.instanceDown) {
        setBroadcastInstanceDown(true);
        setActiveBroadcastJobId(null);
        loadBroadcasts();
        return;
      }

      if (data?.paused || data?.done) {
        setActiveBroadcastJobId(null);
        setActiveBroadcastProgress(null);
        setActiveBroadcastCountdown(0);
        loadBroadcasts();
        return;
      }

      setActiveBroadcastProgress((prev) => ({
        current: data.current_index ?? (prev?.current ?? 0),
        total: data.total_count ?? (prev?.total ?? 0),
        contact: data.contact ?? prev?.contact,
        lastSent: data.success ? data.contact ?? prev?.contact : prev?.lastSent,
      }));

      if (data.done) {
        setActiveBroadcastJobId(null);
        setActiveBroadcastCountdown(0);
        loadBroadcasts();
        return;
      }

      // Countdown entre envios
      for (let i = delaySeconds; i > 0; i--) {
        if (broadcastRunnerRef.current.stop) return;
        setActiveBroadcastCountdown(i);
        await new Promise<void>((r) => setTimeout(r, 1000));
      }
      setActiveBroadcastCountdown(0);

      if (!broadcastRunnerRef.current.stop) run();
    };

    run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const stopBroadcastRunner = () => {
    broadcastRunnerRef.current.stop = true;
    setActiveBroadcastJobId(null);
    setActiveBroadcastProgress(null);
    setActiveBroadcastCountdown(0);
  };

  // ── Criar Broadcast ────────────────────────────────────────────────────────
  const handleCreateBroadcast = async () => {
    if (!selectedChannel || selectedChannel.type !== 'evolution') return;
    const selectedMsg = broadcastMessages.find((m) => m.id === broadcastSelectedMsgId);
    if (!selectedMsg) { setBroadcastError('Selecione uma mensagem template'); return; }
    if (broadcastContacts.length === 0) { setBroadcastError('Importe os contatos (CSV)'); return; }

    // Monta message_config a partir do template
    let message_config: { type: string; content?: string; attachment_url?: string; caption?: string };
    if (selectedMsg.message_type === 'text_only') {
      message_config = { type: 'text', content: selectedMsg.content };
    } else if (selectedMsg.message_type === 'audio') {
      message_config = { type: 'audio', attachment_url: selectedMsg.attachment_url ?? '' };
    } else if (selectedMsg.message_type === 'ptv') {
      message_config = { type: 'video', attachment_url: selectedMsg.attachment_url ?? '' };
    } else {
      // text_with_attachment — usa caption = content
      message_config = { type: 'image', attachment_url: selectedMsg.attachment_url ?? '', caption: selectedMsg.content };
    }

    setBroadcastCreating(true);
    setBroadcastError(null);
    try {
      const res = await fetch('/api/chat/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          instance_id: selectedChannel.id,
          title: broadcastTitle || selectedMsg.title,
          message_config,
          contacts: broadcastContacts,
          delay_seconds: broadcastDelay,
        }),
      });
      const result = await res.json();
      if (!result.success) { setBroadcastError(result.error ?? 'Erro ao criar disparo'); return; }
      setShowBroadcastForm(false);
      setBroadcastTitle('');
      setBroadcastSelectedMsgId('');
      setBroadcastContacts([]);
      setBroadcastContactsFileName('');
      const savedDelay = broadcastDelay;
      setBroadcastDelay(120);
      const newJob = result.data as BroadcastJob;
      loadBroadcasts();
      startBroadcastRunner(newJob.id, savedDelay);
    } catch { setBroadcastError('Erro de rede'); } finally { setBroadcastCreating(false); }
  };

  const handleBroadcastAction = async (jobId: string, status: 'running' | 'paused' | 'cancelled', delaySeconds?: number) => {
    if (status === 'paused' || status === 'cancelled') {
      stopBroadcastRunner();
    }
    try {
      await fetch(`/api/chat/broadcast/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status }),
      });
      loadBroadcasts();
      if (status === 'running') {
        const job = broadcasts.find((b) => b.id === jobId);
        startBroadcastRunner(jobId, delaySeconds ?? job?.delay_seconds ?? 120);
      }
    } catch { /* silent */ }
  };

  // ── Carregar Agente de IA ──────────────────────────────────────────────────
  const loadInstanceFlowConfig = useCallback(async (instanceId: string) => {
    setInstanceFlowLoading(true);
    try {
      const res = await fetch(`/api/chat/flow-config?instance_id=${instanceId}`, { headers: authHeaders() });
      const result = await res.json();
      if (result.success) {
        setInstanceFlowConfig(result.data ?? null);
        setSelectedFlowId(result.data?.flows?.id ?? '');
      }
    } catch { /* silent */ } finally { setInstanceFlowLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const loadAvailableFlows = useCallback(async () => {
    try {
      const res = await fetch('/api/flows', { headers: authHeaders() });
      const result = await res.json();
      if (result.success) setAvailableFlows(result.data ?? []);
    } catch { /* silent */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (activeView === 'agent' && selectedChannel?.type === 'evolution') {
      loadInstanceFlowConfig(selectedChannel.id);
      loadAvailableFlows();
    }
  }, [activeView, selectedChannel, loadInstanceFlowConfig, loadAvailableFlows]);

  const handleSaveFlowConfig = async () => {
    if (!selectedChannel || selectedChannel.type !== 'evolution') return;
    setSavingFlowConfig(true);
    setFlowConfigError(null);
    try {
      const res = await fetch('/api/chat/flow-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          instance_id: selectedChannel.id,
          flow_id: selectedFlowId || null,
          is_active: true,
        }),
      });
      const result = await res.json();
      if (!result.success) { setFlowConfigError(result.error ?? 'Erro ao salvar'); return; }
      setInstanceFlowConfig(result.data);
    } catch { setFlowConfigError('Erro de rede'); } finally { setSavingFlowConfig(false); }
  };

  const handleToggleFlowActive = async () => {
    if (!selectedChannel || selectedChannel.type !== 'evolution' || !instanceFlowConfig) return;
    const newActive = !instanceFlowConfig.is_active;
    setSavingFlowConfig(true);
    setFlowConfigError(null);
    try {
      const res = await fetch('/api/chat/flow-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          instance_id: selectedChannel.id,
          flow_id: instanceFlowConfig.flows?.id ?? null,
          is_active: newActive,
        }),
      });
      const result = await res.json();
      if (result.success) setInstanceFlowConfig(result.data);
    } catch { /* silent */ } finally { setSavingFlowConfig(false); }
  };

  // ── Carregar Mensagens (últimas 50 — mais recentes primeiro via DESC+reverse) ──
  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      setHasOlderMessages(false);
      setConvContact(undefined);
      return;
    }

    const convId = selectedConversationId;
    const cached = userId ? readMessagesFromSessionCache(userId, convId) : null;
    if (cached && cached.length > 0) {
      setMessages(cached);
      setHasOlderMessages(cached.length >= MESSAGES_PAGE_SIZE);
    }

    const loadMessages = async () => {
      setMessagesLoading(true);
      try {
        const response = await fetch(
          `/api/chat/messages?conversation_id=${convId}&limit=${MESSAGES_PAGE_SIZE}`,
          { headers: authHeaders() }
        );
        const result = await response.json();
        if (result.success) {
          const list = sortMessagesChronological((result.data || []) as Message[]);
          setMessages(list);
          setHasOlderMessages(result.meta?.has_more === true);
          if (userId) writeMessagesToSessionCache(userId, convId, list);
        }
      } catch (error) {
        console.error('[Chat] carregar mensagens:', error);
      } finally {
        setMessagesLoading(false);
      }
    };

    loadMessages();
  }, [selectedConversationId, userId]);

  /** Persiste histórico exibido (incl. chegadas via Realtime) para reabrir sem nova busca quando possível */
  useEffect(() => {
    if (!userId || !selectedConversationId || messages.length === 0) return;
    const id = selectedConversationId;
    const t = window.setTimeout(() => writeMessagesToSessionCache(userId, id, messages), 300);
    return () => clearTimeout(t);
  }, [userId, selectedConversationId, messages]);

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
          setMessages((prev) => {
            const merged = sortMessagesChronological([...older, ...prev]);
            if (userId && selectedConversationId) writeMessagesToSessionCache(userId, selectedConversationId, merged);
            return merged;
          });
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
  }, [selectedConversationId, loadingOlderMessages, hasOlderMessages, messages, userId]);

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
  }, [selectedConversationId, userId, conversations]);

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
              const mid = msg.message_id;
              if (mid && prev.some((m) => m.message_id === mid)) return prev;
              return sortMessagesChronological([...prev, msg]);
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
            setMessages((prev) => sortMessagesChronological(prev.map((m) => (m.id === msg.id ? msg : m))));
          } else if (payload.eventType === 'DELETE') {
            setMessages((prev) => prev.filter((m) => m.id !== (payload.old as { id?: string }).id));
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
  useEffect(() => {
    if (!selectedChannel || selectedChannel.type !== 'whatsapp_official' || !userId) return;

    const channel = supabase
      .channel('webhook_events_whatsapp_official')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'webhook_events', filter: 'source=eq.whatsapp_official' },
        (payload) => {
          const row = payload.new as { id?: string };
          if (!row?.id) return;
          fetch('/api/chat/webhook-events/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ event_id: row.id }),
          })
            .then((r) => r.json())
            .then((res) => {
              if (res.data?.token_alert) {
                setShowTokenAlert(true);
                setTokenAlertMessage(res.data.token_alert_message || 'Token de acesso inválido ou expirado. Renove o token em Admin > WhatsApp Oficial.');
              }
            })
            .catch((e) => console.error('[Chat] webhook process:', e));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedChannel, userId]);

  // ── Realtime: conversas ────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedChannel) return;

    const filterCol = selectedChannel.type === 'evolution' ? 'instance_id' : 'whatsapp_config_id';
    const filterVal = selectedChannel.id;
    const canNotify =
      userStatus === 'super_admin' ||
      userStatus === 'admin' ||
      userStatus === 'suporte' ||
      userStatus === 'gerente' ||
      userStatus === 'consultor';

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
              const next = sort24(updated);
              conversationsCacheRef.current[filterVal] = next;
              return next;
            });

            if (isNew && canNotify && typeof window !== 'undefined' && 'Notification' in window) {
              const convTitle = newConv.title || 'Nova conversa';
              const preview = (newConv.last_message_preview || '').slice(0, 60);
              if (document.visibilityState === 'hidden' && Notification.permission === 'granted') {
                try {
                  new Notification('Nova conversa no Chat Atendimento — Zaploto', {
                    body: preview
                      ? `${convTitle}: ${preview}${preview.length >= 60 ? '...' : ''}`
                      : convTitle,
                    icon: '/favicon.ico',
                  });
                } catch (_) {}
              }
            }
          } else if (payload.eventType === 'DELETE') {
            const removedId = (payload.old as Conversation).id;
            if (!removedId) return;
            setConversations((prev) => {
              const next = prev.filter((c) => c.id !== removedId);
              conversationsCacheRef.current[filterVal] = next;
              return next;
            });
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedChannel, userStatus]);

  // ── Permissão de notificação ───────────────────────────────────────────────
  useEffect(() => {
    const canNotify =
      userStatus === 'super_admin' ||
      userStatus === 'admin' ||
      userStatus === 'suporte' ||
      userStatus === 'gerente' ||
      userStatus === 'consultor';
    if (!canNotify || typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  }, [userStatus]);

  // ── Upload de arquivo ──────────────────────────────────────────────────────
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedChannel) return;
    setUploading(true);
    e.target.value = '';
    try {
      if (selectedChannel.type === 'evolution') {
        const allowedEvolutionImage = ['image/jpeg', 'image/png', 'image/webp'];
        const mimeType = (file.type || '').split(';')[0].trim().toLowerCase();
        if (!allowedEvolutionImage.includes(mimeType)) {
          alert('Na Evolution, apenas imagem (JPG, PNG, WEBP) é permitida neste envio.');
          return;
        }

        const formData = new FormData();
        formData.append('file', file);
        formData.append('instance_id', selectedChannel.id);
        const res = await fetch('/api/chat/evolution/upload-media', {
          method: 'POST',
          body: formData,
          headers: authHeaders(),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success || !data.data?.url) {
          alert(data.error || data.message || 'Falha no upload da imagem');
          return;
        }
        const preview = URL.createObjectURL(file);
        setAttachedMedia({
          url: data.data.url,
          type: 'image',
          name: file.name,
          preview,
          mimetype: data.data?.mime_type || mimeType,
        });
        return;
      }

      if (selectedChannel.type === 'whatsapp_official') {
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
      }
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
    if (!selectedChannel) {
      alert('Selecione um canal para gravar áudio');
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
    if (!selectedChannel || !userId) return;
    setUploading(true);
    try {
      const baseType = mimeType.split(';')[0].trim().toLowerCase();
      const extMap: Record<string, string> = {
        'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a',
        'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/mpeg': 'mp3',
      };
      const ext = extMap[baseType] ?? 'ogg';
      const fileName = `audio_${Date.now()}.${ext}`;

      if (selectedChannel.type === 'evolution') {
        const fd = new FormData();
        fd.append('file', new File([blob], fileName, { type: baseType }));
        fd.append('instance_id', selectedChannel.id);
        const uploadRes = await fetch('/api/chat/evolution/upload-media', {
          method: 'POST',
          headers: authHeaders(),
          body: fd,
        });
        const uploadData = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok || !uploadData?.success || !uploadData?.data?.url) {
          alert(uploadData?.error || 'Falha no upload do áudio. Tente novamente.');
          return;
        }
        setAttachedMedia({
          url: uploadData.data.url,
          type: 'audio',
          name: 'Áudio gravado',
          mimetype: baseType,
        });
        return;
      }

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

      setAttachedMedia({ url, meta_id, type: 'audio', name: 'Áudio gravado', mimetype: baseType });
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
    if (!showConversationMenu) return;
    const onOutside = (e: MouseEvent) => {
      if (conversationMenuRef.current && !conversationMenuRef.current.contains(e.target as Node)) {
        setShowConversationMenu(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [showConversationMenu]);

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
        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedConversationId
              ? { ...c, attendance_status: 'resolvido' as const, resolved_at: data.data.resolved_at }
              : c
          )
        );
      }
    } catch (e) {
      console.error('[Chat] Resolver conversa:', e);
    } finally {
      setResolvingConversation(false);
    }
  };

  const handleEditClientNameFromMenu = () => {
    setShowConversationMenu(false);
    openContactModal();
  };

  const handleResolveConversationFromList = async (conversationId: string) => {
    if (!conversationId || closingConversationId) return;
    const conv = conversations.find((c) => c.id === conversationId);
    if (!conv || conv.attendance_status === 'resolvido') return;
    setClosingConversationId(conversationId);
    try {
      const res = await fetch('/api/chat/conversations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          conversation_id: conversationId,
          attendance_status: 'resolvido',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  attendance_status: 'resolvido' as const,
                  resolved_at: data.data?.resolved_at ?? c.resolved_at ?? new Date().toISOString(),
                }
              : c
          )
        );
      }
    } catch (e) {
      console.error('[Chat] Resolver conversa (lista):', e);
    } finally {
      setClosingConversationId(null);
    }
  };

  // ── Envio de mensagem ──────────────────────────────────────────────────────
  const getSendErrorMessage = (status: number, bodyError?: string): string => {
    if (bodyError && bodyError.trim()) return bodyError;
    switch (status) {
      case 502: return 'Serviço temporariamente indisponível. Tente novamente.';
      case 503: return 'Serviço temporariamente indisponível. Tente outra instância ou aguarde um instante.';
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
            ...(hasMedia
              ? {
                  type: 'media',
                  media: attachedMedia!.url,
                  mimetype: attachedMedia!.mimetype || 'audio/ogg',
                  mediatype: attachedMedia!.type,
                  caption: hasText ? messageText.trim() : undefined,
                  fileName: attachedMedia!.name,
                }
              : {
                  type: 'text',
                  text: messageText,
                }),
          }),
        });
        let result: EvolutionSendApiResult = {};
        try {
          result = (await response.json()) as EvolutionSendApiResult;
        } catch {
          result = {};
        }
        if (response.ok && result.success) {
          if (attachedMedia?.preview) URL.revokeObjectURL(attachedMedia.preview);
          setMessageText('');
          setAttachedMedia(null);
          if (textareaRef.current) textareaRef.current.style.height = 'auto';
          const saved = (result as { data?: { message?: Message | null } }).data?.message;
          if (saved && saved.id) {
            const msg: Message = {
              ...saved,
              timestamp:
                typeof saved.timestamp === 'string'
                  ? parseInt(saved.timestamp, 10)
                  : saved.timestamp,
            };
            setMessages((prev) => {
              if (prev.some((m) => m.id === msg.id)) return prev;
              const mid = msg.message_id;
              if (mid && prev.some((m) => m.message_id === mid)) return prev;
              return sortMessagesChronological([...prev, msg]);
            });
          }
        } else if (result.code === EVOLUTION_INSTANCE_UNREACHABLE_CODE) {
          reopenAtendimentoInstancePickerWithNotice(
            result.error ||
              'A instância WhatsApp desconectou ou ficou indisponível. Escolha outra instância ou reconecte em Instâncias WhatsApp.'
          );
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
              ...(attachedMedia!.meta_id
                ? { meta_id: attachedMedia!.meta_id, media_url: attachedMedia!.url || undefined }
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
          const errMsg = result.error || result.message || '';
          setSendError(getSendErrorMessage(response.status, errMsg));
          const isTokenError = response.status === 401 ||
            (response.status === 502 && (errMsg.toLowerCase().includes('token') || errMsg.includes('190') || errMsg.includes('OAuthException')));
          if (isTokenError) {
            setShowTokenAlert(true);
            setTokenAlertMessage('Token de acesso inválido ou expirado. Renove o token em Admin > WhatsApp Oficial.');
          }
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
        const nextName = String(data.data?.name || '').trim();
        if (nextName && selectedConversationId) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === selectedConversationId
                ? { ...c, title: nextName }
                : c
            )
          );
        }
        if (crmChatContactsUser) void refreshChatContacts();
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

  const handleStartConversation = async () => {
    if (!selectedChannel || creatingConversation) return;
    const normalizedPhone = startConversationPhone.replace(/\D/g, '');
    if (!normalizedPhone || normalizedPhone.length < 10 || normalizedPhone.length > 15) {
      setStartConversationError('Número inválido. Use apenas números (10 a 15 dígitos).');
      return;
    }

    setCreatingConversation(true);
    setStartConversationError(null);
    try {
      const body =
        selectedChannel.type === 'evolution'
          ? { instance_id: selectedChannel.id, phone: normalizedPhone, title: normalizedPhone }
          : { whatsapp_config_id: selectedChannel.id, phone: normalizedPhone, title: normalizedPhone };

      const res = await fetch('/api/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success || !data?.data?.id) {
        setStartConversationError(data?.error || 'Não foi possível abrir a conversa.');
        return;
      }

      const newConversation = data.data as Conversation;
      setConversations((prev) => {
        const withoutCurrent = prev.filter((c) => c.id !== newConversation.id);
        const next = [newConversation, ...withoutCurrent];
        if (selectedChannel) {
          conversationsCacheRef.current[selectedChannel.id] = next;
        }
        return next;
      });
      setSelectedConversationId(newConversation.id);
      setActiveView('chat');
      setShowStartConversationModal(false);
      setStartConversationPhone('');
    } catch {
      setStartConversationError('Falha na conexão. Tente novamente.');
    } finally {
      setCreatingConversation(false);
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
      case 'sent': return <BadgeCheck className="w-4 h-4" />;
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
  // Todos = atribuídas a mim
  // Histórico = fora da janela 24h (template) ou já resolvidas
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
    const in24h = isWithin24hWindow(conv);
    const resolved = conv.attendance_status === 'resolvido';
    switch (conversationFilter) {
      case 'mine':
        return conv.user_id === userId && conv.attendance_status !== 'resolvido';
      case 'unassigned':
      default:
        // Histórico: template (fora 24h) ou resolvidas
        return !in24h || resolved;
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

  const mineCount = conversations.filter((c) => c.user_id === userId).length;
  const historyCount = conversations.filter(
    (c) => !isWithin24hWindow(c) || c.attendance_status === 'resolvido'
  ).length;

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

  // Tela inicial: escolher / confirmar instância (Evolution) ou canal WhatsApp Oficial antes de abrir o chat
  if (!atendimentoGatePassed) {
    const totalCanais = channels.evolution.length + channels.whatsapp_official.length;
    const statusConfig = (status: string) => {
      const s = (status || '').toLowerCase();
      if (s === 'open' || s === 'connected' || s === 'ok') return { dot: 'bg-emerald-400', label: 'Conectado', text: 'text-emerald-600 dark:text-emerald-400' };
      if (s === 'connecting') return { dot: 'bg-amber-400 animate-pulse', label: 'Conectando', text: 'text-amber-600 dark:text-amber-400' };
      return { dot: 'bg-red-400', label: 'Desconectado', text: 'text-red-500 dark:text-red-400' };
    };

    return (
      <Layout onSignOut={handleSignOut}>
        <div className="flex flex-1 min-h-0 flex-col items-center justify-center p-4 sm:p-6 overflow-y-auto bg-gray-50 dark:bg-[#1a1a1a]">
          <div className="w-full max-w-2xl">

            {/* Header */}
            <div className="text-center mb-8">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg"
                style={{ backgroundColor: '#8CD955' }}
              >
                <Headphones className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                Chat de Atendimento
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {userStatus === 'gerente'
                  ? 'Suas instâncias aparecem abaixo. Vincule a banca e um ou mais consultores para eles acessarem esta instância no atendimento.'
                  : 'Selecione a instância WhatsApp para iniciar o atendimento'}
              </p>
            </div>

            {atendimentoGateNotice && (
              <div
                className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/50 bg-amber-500/10 dark:bg-amber-500/15 px-4 py-3 text-amber-900 dark:text-amber-100"
                role="alert"
              >
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <div className="flex-1 min-w-0 text-sm">{atendimentoGateNotice}</div>
                <button
                  type="button"
                  onClick={() => setAtendimentoGateNotice(null)}
                  className="flex-shrink-0 p-1 rounded-lg hover:bg-amber-500/20 text-amber-800 dark:text-amber-200"
                  aria-label="Fechar aviso"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Card */}
            <div className="bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-2xl shadow-sm overflow-hidden">

              {channelsLoading ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-400">
                  <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#8CD955' }} />
                  <span className="text-sm">Carregando instâncias disponíveis...</span>
                </div>

              ) : totalCanais === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-16 px-8 text-center">
                  <div className="w-14 h-14 rounded-full bg-gray-100 dark:bg-[#333] flex items-center justify-center">
                    <MessageSquare className="w-7 h-7 text-gray-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Nenhuma instância disponível
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 max-w-xs">
                    {userStatus === 'gerente' ? (
                      <>
                        Nenhuma instância Evolution ativa na sua conta. Crie em{' '}
                        <Link href="/instances" className="underline" style={{ color: '#8CD955' }}>
                          Instâncias WhatsApp
                        </Link>
                        ; ao conectar, ela aparecerá aqui para você vincular um consultor.
                      </>
                    ) : (
                      <>
                        Você ainda não possui instâncias WhatsApp ativas. Crie uma em{' '}
                        <Link href="/instances" className="underline" style={{ color: '#8CD955' }}>
                          Instâncias WhatsApp
                        </Link>
                        {' '}
                        ou peça ao gerente para atribuir uma instância de atendimento.
                      </>
                    )}
                  </p>
                </div>

              ) : (
                <>
                  {/* Label */}
                  <div className="px-5 pt-5 pb-3 border-b border-gray-100 dark:border-[#3a3a3a]">
                    <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                      {channels.evolution.length} {channels.evolution.length === 1 ? 'instância disponível' : 'instâncias disponíveis'}
                    </p>
                  </div>

                  {/* Instance grid */}
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[min(55vh,400px)] overflow-y-auto">
                    {channels.evolution.map((ch) => {
                      const selected = pendingAtendimentoChannel && channelPickerKey(pendingAtendimentoChannel) === channelPickerKey(ch);
                      const sc = statusConfig(ch.status);
                      const gRow = userStatus === 'gerente' ? gerenteGateAssignmentByInstance[ch.id] : undefined;
                      return (
                        <div
                          key={channelPickerKey(ch)}
                          className={`relative text-left rounded-xl border-2 overflow-hidden transition-all duration-150 ${
                            selected
                              ? 'border-[#8CD955] bg-[#8CD955]/8 dark:bg-[#8CD955]/12 shadow-sm'
                              : 'border-gray-200 dark:border-[#3a3a3a] hover:border-[#8CD955]/50 hover:bg-gray-50 dark:hover:bg-[#333]'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setPendingAtendimentoChannel(ch)}
                            className="w-full text-left p-4"
                          >
                            {selected && (
                              <span
                                className="absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center z-[1]"
                                style={{ backgroundColor: '#8CD955' }}
                              >
                                <CheckCheck className="w-3 h-3 text-white" />
                              </span>
                            )}

                            <div className="flex items-center gap-3 mb-3">
                              <div className="relative flex-shrink-0">
                                <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-[#444] flex items-center justify-center">
                                  <MessageCircle className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                                </div>
                                <span
                                  className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-[#2a2a2a] ${sc.dot}`}
                                />
                              </div>
                              <div className="min-w-0 flex-1 pr-6">
                                <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
                                  {ch.instance_name}
                                </p>
                                <p className={`text-xs font-medium ${sc.text}`}>{sc.label}</p>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-1">
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800/50">
                                Evolution
                              </span>
                              {ch.is_master && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200 dark:border-amber-800/50">
                                  Mestre
                                </span>
                              )}
                              {ch.is_chat_instance && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-200 dark:border-purple-800/50">
                                  Chat
                                </span>
                              )}
                            </div>
                          </button>

                          {userStatus === 'gerente' && (
                            <div className="px-4 py-3 border-t border-gray-100 dark:border-[#3a3a3a] bg-gray-50/90 dark:bg-[#252525] space-y-3">
                              <div>
                                <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 block mb-1.5">
                                  Banca (CRM)
                                </label>
                                <div className="flex items-center gap-2">
                                  <select
                                    className="flex-1 min-w-0 text-sm rounded-lg border border-gray-200 dark:border-[#505050] bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 px-2 py-2"
                                    disabled={gerenteGateSavingInstanceId === ch.id || gerenteGateBancas.length === 0}
                                    value={gRow?.crm_banca_id || ''}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => {
                                      const v = e.target.value === '' ? null : e.target.value;
                                      handleGerenteGateBancaChange(ch.id, gRow?.id, v);
                                    }}
                                  >
                                    <option value="">
                                      {gerenteGateBancas.length === 0 ? 'Nenhuma banca atribuída' : 'Selecione a banca'}
                                    </option>
                                    {gerenteGateBancas.map((b) => (
                                      <option key={b.id} value={b.id}>
                                        {b.name}
                                      </option>
                                    ))}
                                  </select>
                                  {gerenteGateSavingInstanceId === ch.id && (
                                    <Loader2 className="w-4 h-4 animate-spin shrink-0 text-[#8CD955]" />
                                  )}
                                </div>
                              </div>
                              <div>
                                <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 block mb-1.5">
                                  Consultores no atendimento
                                </label>
                                {!gRow?.crm_banca_id ? (
                                  <p className="text-xs text-gray-500 dark:text-gray-400 py-1">
                                    Escolha uma banca primeiro
                                  </p>
                                ) : (
                                  <>
                                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1.5 leading-snug">
                                      Marque um ou mais consultores; o vínculo é salvo de uma vez ao clicar em «Entrar».
                                    </p>
                                    <div
                                      className="max-h-36 overflow-y-auto rounded-lg border border-gray-200 dark:border-[#505050] bg-white dark:bg-[#333] px-2 py-2 space-y-1.5"
                                      onClick={(e) => e.stopPropagation()}
                                      onKeyDown={(e) => e.stopPropagation()}
                                    >
                                      {(gerenteGateConsultoresByBanca[gRow.crm_banca_id] || []).length === 0 ? (
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                          Nenhum consultor nesta banca
                                        </p>
                                      ) : (
                                        (gerenteGateConsultoresByBanca[gRow.crm_banca_id] || []).map((c) => {
                                          const cur =
                                            gerenteGateConsultoresDraftByInstance[ch.id] ??
                                            gRow.consultor_user_ids ??
                                            [];
                                          const selected = cur.includes(c.id);
                                          return (
                                            <label
                                              key={c.id}
                                              className={`flex items-center gap-2 text-sm cursor-pointer rounded px-1 py-0.5 hover:bg-gray-100 dark:hover:bg-[#3a3a3a] ${
                                                gerenteGateSavingInstanceId === ch.id
                                                  ? 'opacity-50 pointer-events-none'
                                                  : ''
                                              }`}
                                            >
                                              <input
                                                type="checkbox"
                                                className="rounded border-gray-300 dark:border-[#505050]"
                                                checked={selected}
                                                disabled={gerenteGateSavingInstanceId === ch.id}
                                                onChange={(e) => {
                                                  setGerenteGateConsultoresDraftByInstance((prev) => {
                                                    const base = prev[ch.id] ?? gRow.consultor_user_ids ?? [];
                                                    const next = e.target.checked
                                                      ? [...new Set([...base, c.id])]
                                                      : base.filter((id) => id !== c.id);
                                                    return { ...prev, [ch.id]: next };
                                                  });
                                                }}
                                              />
                                              <span className="text-gray-900 dark:text-gray-100 truncate">
                                                {c.full_name || c.email || c.id}
                                              </span>
                                            </label>
                                          );
                                        })
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer com botão */}
                  <div className="px-4 pb-4 pt-2 border-t border-gray-100 dark:border-[#3a3a3a]">
                    <button
                      type="button"
                      disabled={
                        !pendingAtendimentoChannel ||
                        (userStatus === 'gerente' &&
                          pendingAtendimentoChannel.type === 'evolution' &&
                          !gerenteGateAssignmentByInstance[pendingAtendimentoChannel.id]?.crm_banca_id) ||
                        (userStatus === 'gerente' &&
                          pendingAtendimentoChannel.type === 'evolution' &&
                          gerenteGateSavingInstanceId === pendingAtendimentoChannel.id)
                      }
                      onClick={() => {
                        void openAtendimentoWithPendingChannel();
                      }}
                      className="w-full py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                      style={{ backgroundColor: '#8CD955' }}
                    >
                      {userStatus === 'gerente' &&
                      pendingAtendimentoChannel?.type === 'evolution' &&
                      gerenteGateSavingInstanceId === pendingAtendimentoChannel.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Headphones className="w-4 h-4" />
                      )}
                      {pendingAtendimentoChannel
                        ? `Entrar com ${(pendingAtendimentoChannel as ChannelEvolution).instance_name}`
                        : 'Selecione uma instância'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
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
              <Link href="/admin/whatsapp-official" className="text-sm font-medium underline hover:no-underline">
                Renovar token
              </Link>
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
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2 pr-8">Chat Atendimento</h2>
              <button
                type="button"
                onClick={reopenAtendimentoInstancePicker}
                className="mb-3 text-left w-full text-xs font-medium text-[#8CD955] hover:underline"
              >
                ← Trocar instância / canal
              </button>
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
                {selectedChannel?.type === 'evolution' && (
                  <>
                    <button
                      onClick={() => setActiveView('broadcast')}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm font-medium ${
                        activeView === 'broadcast'
                          ? 'text-white'
                          : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#333]'
                      }`}
                      style={activeView === 'broadcast' ? { backgroundColor: '#8CD955' } : {}}
                    >
                      <Megaphone className="w-5 h-5" />
                      Disparo em Massa
                    </button>
                    <button
                      onClick={() => setActiveView('agent')}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm font-medium ${
                        activeView === 'agent'
                          ? 'text-white'
                          : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#333]'
                      }`}
                      style={activeView === 'agent' ? { backgroundColor: '#8CD955' } : {}}
                    >
                      <Bot className="w-5 h-5" />
                      Agente de IA
                    </button>
                  </>
                )}
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
                          {ch.instance_name}
                          {ch.is_master ? ' · Mestre' : ''} ({ch.status})
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
                  {selectedChannel.type === 'evolution' ? (
                    <>
                      {selectedChannel.instance_name}
                      {selectedChannel.is_master ? (
                        <span className="ml-1.5 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                          Mestre
                        </span>
                      ) : null}
                    </>
                  ) : (
                    selectedChannel.name
                  )}
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
                    aria-label="Abrir menu Chat Atendimento"
                    title="Abrir menu (canal, conversas/contatos)"
                  >
                    <PanelLeft className="w-5 h-5" />
                  </button>
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Contatos do Chat</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {crmChatContactsUser
                      ? 'Sincronização em lotes (como no CRM). Use o filtro abaixo e o botão de atualizar.'
                      : 'Clique em um contato para abrir a conversa.'}
                  </p>
                </div>
                {crmChatContactsUser && (
                  <button
                    type="button"
                    onClick={() => syncCrmNow()}
                    disabled={crmSyncLoading || !userId}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#333] text-gray-600 dark:text-gray-300 flex-shrink-0 disabled:opacity-50"
                    title="Sincronizar agora com o CRM"
                  >
                    {crmSyncLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-5 h-5" />
                    )}
                  </button>
                )}
              </div>
              {crmChatContactsUser && crmSyncMessage && (
                <div className="flex-shrink-0 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800/40">
                  {crmSyncMessage}
                </div>
              )}
              {crmChatContactsUser && (
                <div className="flex-shrink-0 px-3 py-2 border-b border-gray-200 dark:border-[#404040] flex gap-1 flex-wrap">
                  {(
                    [
                      { id: 'all' as const, label: 'Todos' },
                      { id: 'kanban' as const, label: 'Kanban' },
                      { id: 'transferred' as const, label: 'Transferido' },
                    ] as const
                  ).map((tab) => {
                    const active = chatContactsKindFilter === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setChatContactsKindFilter(tab.id)}
                        className={`text-xs font-medium px-2.5 py-1 rounded-md transition-colors ${
                          active
                            ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-[#333] dark:text-gray-300 dark:hover:bg-[#404040]'
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="flex-1 overflow-y-auto">
                {crmChatContactsUser ? (
                  chatContactsLoading && chatContactsList.length === 0 ? (
                    <div className="p-6 flex justify-center text-gray-500 dark:text-gray-400">
                      <Loader2 className="w-6 h-6 animate-spin" />
                    </div>
                  ) : chatContactsFiltered.length === 0 ? (
                    <div className="p-6 text-center text-gray-500 dark:text-gray-400 text-sm">
                      {chatContactsList.length === 0
                        ? 'Nenhum contato. Use o botão de sincronizar ou aguarde o CRM.'
                        : 'Nenhum contato neste filtro. Escolha outra aba ou Todos.'}
                    </div>
                  ) : (
                    chatContactsFiltered.map((row) => {
                      const kind = row.crm_sync_kind || 'manual';
                      const badgeClass =
                        kind === 'kanban'
                          ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200'
                          : kind === 'transferred'
                            ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'
                            : 'bg-gray-100 text-gray-700 dark:bg-[#404040] dark:text-gray-200';
                      const badgeLabel =
                        kind === 'kanban' ? 'Kanban' : kind === 'transferred' ? 'Transferido' : 'Manual';
                      const expiresIso = row.crm_snapshot?.transfer_expires_at;
                      const expired =
                        !!expiresIso && !Number.isNaN(new Date(expiresIso).getTime()) && new Date(expiresIso) < new Date();
                      return (
                        <div
                          key={row.id}
                          onClick={() => openContactRow(row.telefone)}
                          className="p-3 border-b border-gray-100 dark:border-[#404040] cursor-pointer hover:bg-gray-50 dark:hover:bg-[#333] transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                              style={{ backgroundColor: getConversationColor(row.name || row.telefone) }}
                            >
                              {getInitials(row.name || row.telefone)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                  {row.name?.trim() || row.telefone}
                                </p>
                                <span
                                  className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${badgeClass}`}
                                >
                                  {badgeLabel}
                                </span>
                              </div>
                              <p className="text-xs text-gray-500 dark:text-gray-400">{row.telefone}</p>
                              {row.crm_snapshot?.status && (
                                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                                  Status CRM: {row.crm_snapshot.status}
                                  {row.crm_snapshot.banca_name ? ` · ${row.crm_snapshot.banca_name}` : ''}
                                </p>
                              )}
                              {kind === 'transferred' && expiresIso && (
                                <p
                                  className={`text-[11px] mt-0.5 font-semibold ${
                                    expired
                                      ? 'text-red-700 dark:text-red-400'
                                      : 'text-red-600 dark:text-red-400'
                                  }`}
                                >
                                  Expira em {formatTransferExpiryDay(expiresIso)}
                                  {expired ? ' · prazo vencido' : ''}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )
                ) : conversations.length === 0 ? (
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
                            {conv.profile_pic_url ? (
                              <img
                                src={conv.profile_pic_url}
                                alt={conv.title || phone}
                                className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                              />
                            ) : (
                              <div
                                className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                                style={{ backgroundColor: getConversationColor(conv.title || '') }}
                              >
                                {getInitials(conv.title || phone)}
                              </div>
                            )}
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
          ) : activeView === 'broadcast' ? (
            /* Vista Disparo em Massa */
            <div className="min-w-0 flex-1 md:w-80 md:flex-shrink-0 overflow-hidden bg-white dark:bg-[#2a2a2a] border-r border-gray-200 dark:border-[#404040] flex flex-col">
              {/* Header */}
              <div className="flex-shrink-0 p-3 border-b border-gray-200 dark:border-[#404040] flex items-center gap-2">
                {!chatSidebarOpen && (
                  <button type="button" onClick={() => setChatSidebarOpen(true)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#333] text-gray-600 dark:text-gray-300 flex-shrink-0"><PanelLeft className="w-5 h-5" /></button>
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Disparo em Massa</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">Envios em lote para contatos</p>
                </div>
                {!showBroadcastForm && (
                  <button
                    type="button"
                    onClick={() => { setShowBroadcastForm(true); setBroadcastError(null); loadBroadcastMessages(); }}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-[#333] text-gray-600 dark:text-gray-300 flex-shrink-0"
                    title="Novo disparo"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Aviso instância offline */}
              {broadcastInstanceDown && (
                <div className="flex-shrink-0 mx-3 mt-3 p-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-red-700 dark:text-red-400">Instância offline</p>
                    <p className="text-xs text-red-600 dark:text-red-500">O disparo foi pausado. Reconecte a instância e retome.</p>
                  </div>
                  <button type="button" onClick={() => setBroadcastInstanceDown(false)} className="text-red-400 hover:text-red-600 flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
                </div>
              )}

              {/* Runner ativo — progresso em tempo real */}
              {activeBroadcastJobId && activeBroadcastProgress && (
                <div className="flex-shrink-0 mx-3 mt-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Disparando em tempo real
                    </span>
                    <span className="text-xs text-blue-600 dark:text-blue-400">
                      {activeBroadcastProgress.current}/{activeBroadcastProgress.total}
                    </span>
                  </div>
                  <div className="h-1.5 bg-blue-200 dark:bg-blue-900 rounded-full">
                    <div
                      className="h-1.5 rounded-full transition-all"
                      style={{
                        width: `${activeBroadcastProgress.total > 0 ? Math.round((activeBroadcastProgress.current / activeBroadcastProgress.total) * 100) : 0}%`,
                        backgroundColor: '#8CD955',
                      }}
                    />
                  </div>
                  {activeBroadcastProgress.lastSent && (
                    <p className="text-xs text-blue-600 dark:text-blue-400 truncate">
                      Enviado: {activeBroadcastProgress.lastSent.name || activeBroadcastProgress.lastSent.phone}
                    </p>
                  )}
                  {activeBroadcastCountdown > 0 && (
                    <p className="text-xs text-blue-500 dark:text-blue-400">
                      Próximo envio em <span className="font-semibold">{activeBroadcastCountdown}s</span>
                    </p>
                  )}
                </div>
              )}

              {/* Formulário de novo disparo */}
              {showBroadcastForm && (
                <div className="flex-shrink-0 overflow-y-auto border-b border-gray-200 dark:border-[#404040]">
                  <div className="p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Novo Disparo</p>
                      <button type="button" onClick={() => setShowBroadcastForm(false)} className="text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>
                    </div>

                    {/* Título */}
                    <input
                      type="text"
                      placeholder="Título (opcional)"
                      value={broadcastTitle}
                      onChange={(e) => setBroadcastTitle(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm border rounded-lg bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 border-gray-300 dark:border-[#404040] focus:ring-2 focus:ring-[#8CD955]"
                    />

                    {/* Selecionar mensagem template */}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Mensagem</label>
                      {broadcastMessagesLoading ? (
                        <div className="flex items-center gap-2 py-2"><Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" /><span className="text-xs text-gray-400">Carregando...</span></div>
                      ) : broadcastMessages.length === 0 ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400 py-1">Nenhuma mensagem encontrada. Crie em CRM &gt; Mensagens.</p>
                      ) : (
                        <div className="space-y-1 max-h-36 overflow-y-auto border rounded-lg border-gray-200 dark:border-[#404040]">
                          {broadcastMessages.map((msg) => {
                            const typeLabel: Record<string, string> = {
                              text_only: 'Texto',
                              audio: 'Áudio',
                              ptv: 'Vídeo (PTV)',
                              text_with_attachment: 'Mídia',
                            };
                            return (
                              <button
                                key={msg.id}
                                type="button"
                                onClick={() => setBroadcastSelectedMsgId(msg.id)}
                                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                                  broadcastSelectedMsgId === msg.id
                                    ? 'bg-[#8CD955] text-white'
                                    : 'hover:bg-gray-50 dark:hover:bg-[#333] text-gray-900 dark:text-gray-100'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <span className="font-medium truncate">{msg.title}</span>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${broadcastSelectedMsgId === msg.id ? 'bg-white/30 text-white' : 'bg-gray-100 dark:bg-[#444] text-gray-500'}`}>
                                    {typeLabel[msg.message_type] ?? msg.message_type}
                                  </span>
                                </div>
                                {msg.preview && (
                                  <p className={`text-xs truncate mt-0.5 ${broadcastSelectedMsgId === msg.id ? 'text-white/80' : 'text-gray-500 dark:text-gray-400'}`}>{msg.preview}</p>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Upload CSV contatos */}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Contatos (CSV)</label>
                      <input
                        ref={broadcastFileInputRef}
                        type="file"
                        accept=".csv,.txt"
                        className="hidden"
                        onChange={handleBroadcastFileUpload}
                      />
                      <button
                        type="button"
                        onClick={() => broadcastFileInputRef.current?.click()}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm border-2 border-dashed rounded-lg border-gray-300 dark:border-[#505050] text-gray-600 dark:text-gray-400 hover:border-[#8CD955] hover:text-[#8CD955] transition-colors"
                      >
                        <FileText className="w-4 h-4" />
                        {broadcastContactsFileName ? broadcastContactsFileName : 'Importar CSV'}
                      </button>
                      {broadcastContacts.length > 0 && (
                        <div className="mt-1.5">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs text-gray-600 dark:text-gray-400">
                              <span className="font-semibold text-[#8CD955]">{broadcastContacts.length}</span> contatos carregados
                            </p>
                            <button type="button" onClick={() => { setBroadcastContacts([]); setBroadcastContactsFileName(''); }} className="text-xs text-red-500 hover:text-red-700">Limpar</button>
                          </div>
                          <div className="max-h-24 overflow-y-auto border rounded border-gray-200 dark:border-[#404040] divide-y divide-gray-100 dark:divide-[#404040]">
                            {broadcastContacts.slice(0, 50).map((c, i) => (
                              <div key={i} className="px-2 py-1 flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                                <span className="font-mono flex-shrink-0">{c.phone}</span>
                                {c.name && <span className="truncate text-gray-500 dark:text-gray-400">{c.name}</span>}
                              </div>
                            ))}
                            {broadcastContacts.length > 50 && (
                              <div className="px-2 py-1 text-xs text-gray-400">... e mais {broadcastContacts.length - 50}</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Intervalo */}
                    <div className="flex items-center gap-3">
                      <label className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">Intervalo entre envios:</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={10}
                          max={600}
                          value={broadcastDelay}
                          onChange={(e) => setBroadcastDelay(Math.min(600, Math.max(10, Number(e.target.value))))}
                          className="w-16 px-2 py-1 text-sm border rounded-lg bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 border-gray-300 dark:border-[#404040] text-center"
                        />
                        <span className="text-xs text-gray-500">seg</span>
                      </div>
                    </div>

                    {broadcastError && (
                      <div className="flex items-center gap-1.5 p-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                        <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                        <p className="text-xs text-red-600 dark:text-red-400">{broadcastError}</p>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleCreateBroadcast}
                        disabled={broadcastCreating || !broadcastSelectedMsgId || broadcastContacts.length === 0}
                        className="flex-1 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
                        style={{ backgroundColor: '#8CD955' }}
                      >
                        {broadcastCreating ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Criando...</> : <><Megaphone className="w-3.5 h-3.5" />Criar e Iniciar</>}
                      </button>
                      <button type="button" onClick={() => { setShowBroadcastForm(false); setBroadcastError(null); }} className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-[#404040] text-gray-700 dark:text-gray-200">Cancelar</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Lista de disparos */}
              <div className="flex-1 overflow-y-auto">
                {broadcastsLoading ? (
                  <div className="p-6 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" /></div>
                ) : broadcasts.length === 0 ? (
                  <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
                    <Megaphone className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    Nenhum disparo encontrado.<br/>Clique em + para criar.
                  </div>
                ) : (
                  broadcasts.map((job) => {
                    const statusColor: Record<string, string> = {
                      pending: 'text-yellow-600 dark:text-yellow-400',
                      running: 'text-blue-600 dark:text-blue-400',
                      paused: 'text-orange-600 dark:text-orange-400',
                      completed: 'text-green-600 dark:text-green-400',
                      failed: 'text-red-600 dark:text-red-400',
                      cancelled: 'text-gray-500 dark:text-gray-400',
                    };
                    const statusLabel: Record<string, string> = {
                      pending: 'Pendente', running: 'Rodando', paused: 'Pausado',
                      completed: 'Concluído', failed: 'Falhou', cancelled: 'Cancelado',
                    };
                    const pct = job.total_count > 0 ? Math.round((job.current_index / job.total_count) * 100) : 0;
                    const isActive = activeBroadcastJobId === job.id;
                    return (
                      <div key={job.id} className={`p-3 border-b border-gray-100 dark:border-[#404040] ${isActive ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}>
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{job.title}</p>
                          <span className={`text-xs font-medium flex-shrink-0 ${statusColor[job.status] ?? ''}`}>{statusLabel[job.status] ?? job.status}</span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">
                          {job.instance_name} · {job.current_index}/{job.total_count} · {job.delay_seconds}s
                        </p>
                        <div className="mb-2">
                          <div className="h-1.5 bg-gray-200 dark:bg-[#444] rounded-full">
                            <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: '#8CD955' }} />
                          </div>
                          <div className="flex justify-between mt-0.5">
                            <span className="text-[10px] text-gray-400">{pct}%</span>
                            {isActive && activeBroadcastCountdown > 0 && (
                              <span className="text-[10px] text-blue-500">próximo: {activeBroadcastCountdown}s</span>
                            )}
                          </div>
                        </div>
                        {job.last_error && <p className="text-xs text-red-500 truncate mb-1">{job.last_error}</p>}
                        {isActive && activeBroadcastProgress?.lastSent && (
                          <p className="text-xs text-blue-600 dark:text-blue-400 truncate mb-1">
                            Enviado: {activeBroadcastProgress.lastSent.name || activeBroadcastProgress.lastSent.phone}
                          </p>
                        )}
                        <div className="flex gap-1.5">
                          {job.status === 'pending' && !isActive && (
                            <button type="button" onClick={() => handleBroadcastAction(job.id, 'running', job.delay_seconds)} className="px-2 py-0.5 text-[11px] rounded border border-blue-400 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center gap-1"><Play className="w-3 h-3" />Iniciar</button>
                          )}
                          {(job.status === 'running' || isActive) && (
                            <button type="button" onClick={() => handleBroadcastAction(job.id, 'paused')} className="px-2 py-0.5 text-[11px] rounded border border-orange-400 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 flex items-center gap-1"><Pause className="w-3 h-3" />Pausar</button>
                          )}
                          {job.status === 'paused' && !isActive && (
                            <button type="button" onClick={() => handleBroadcastAction(job.id, 'running', job.delay_seconds)} className="px-2 py-0.5 text-[11px] rounded border border-blue-400 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center gap-1"><Play className="w-3 h-3" />Retomar</button>
                          )}
                          {(job.status === 'pending' || job.status === 'running' || job.status === 'paused' || isActive) && (
                            <button type="button" onClick={() => handleBroadcastAction(job.id, 'cancelled')} className="px-2 py-0.5 text-[11px] rounded border border-gray-300 dark:border-[#505050] text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#3a3a3a] flex items-center gap-1"><Square className="w-3 h-3" />Cancelar</button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : activeView === 'agent' ? (
            /* Vista Agente de IA */
            <div className="min-w-0 flex-1 md:w-80 md:flex-shrink-0 overflow-hidden bg-white dark:bg-[#2a2a2a] border-r border-gray-200 dark:border-[#404040] flex flex-col">
              <div className="flex-shrink-0 p-3 border-b border-gray-200 dark:border-[#404040] flex items-center gap-2">
                {!chatSidebarOpen && (
                  <button type="button" onClick={() => setChatSidebarOpen(true)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#333] text-gray-600 dark:text-gray-300 flex-shrink-0"><PanelLeft className="w-5 h-5" /></button>
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Agente de IA</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">Automação por flow nesta instância</p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {selectedChannel?.type !== 'evolution' ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Agente de IA disponível apenas para canais Evolution.</p>
                ) : instanceFlowLoading ? (
                  <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
                ) : (
                  <>
                    {instanceFlowConfig?.flows && (
                      <div className="p-3 rounded-lg border border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#333]">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{instanceFlowConfig.flows.name}</p>
                          <button
                            type="button"
                            onClick={handleToggleFlowActive}
                            disabled={savingFlowConfig}
                            className="flex-shrink-0 disabled:opacity-50"
                            title={instanceFlowConfig.is_active ? 'Desativar agente' : 'Ativar agente'}
                          >
                            {instanceFlowConfig.is_active
                              ? <ToggleRight className="w-7 h-7 text-[#8CD955]" />
                              : <ToggleLeft className="w-7 h-7 text-gray-400" />
                            }
                          </button>
                        </div>
                        {instanceFlowConfig.flows.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">{instanceFlowConfig.flows.description}</p>
                        )}
                        <p className="text-xs mt-1">
                          <span className={instanceFlowConfig.is_active ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}>
                            {instanceFlowConfig.is_active ? 'Ativo' : 'Inativo'}
                          </span>
                        </p>
                      </div>
                    )}

                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                        {instanceFlowConfig?.flows ? 'Trocar flow' : 'Vincular flow'}
                      </label>
                      <div className="relative">
                        <select
                          value={selectedFlowId}
                          onChange={(e) => setSelectedFlowId(e.target.value)}
                          className="w-full px-3 py-2 text-sm border rounded-lg bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 border-gray-300 dark:border-[#404040] focus:ring-2 focus:ring-[#8CD955] appearance-none pr-8"
                        >
                          <option value="">Nenhum</option>
                          {availableFlows.map((f) => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                      </div>
                      {flowConfigError && <p className="text-xs text-red-500">{flowConfigError}</p>}
                      <button
                        type="button"
                        onClick={handleSaveFlowConfig}
                        disabled={savingFlowConfig}
                        className="w-full py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50"
                        style={{ backgroundColor: '#8CD955' }}
                      >
                        {savingFlowConfig ? 'Salvando...' : 'Salvar configuração'}
                      </button>
                      {instanceFlowConfig?.flows && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (!selectedChannel || selectedChannel.type !== 'evolution') return;
                            setSavingFlowConfig(true);
                            try {
                              await fetch(`/api/chat/flow-config?instance_id=${selectedChannel.id}`, { method: 'DELETE', headers: authHeaders() });
                              setInstanceFlowConfig(null);
                              setSelectedFlowId('');
                            } catch { /* silent */ } finally { setSavingFlowConfig(false); }
                          }}
                          disabled={savingFlowConfig}
                          className="w-full py-1.5 text-sm text-red-600 dark:text-red-400 rounded-lg border border-red-300 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Remover agente
                        </button>
                      )}
                    </div>
                  </>
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
                      aria-label="Abrir menu Chat Atendimento"
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
                <div className="mb-3">
                  <button
                    type="button"
                    onClick={() => {
                      setStartConversationError(null);
                      setStartConversationPhone('');
                      setShowStartConversationModal(true);
                    }}
                    disabled={!selectedChannel}
                    className="w-full px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-[#404040] text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-[#333] hover:bg-gray-200 dark:hover:bg-[#3a3a3a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Chamar cliente por número
                  </button>
                </div>
                <div className="flex items-center gap-1 border-b border-gray-200 dark:border-[#404040] -mx-4 px-4">
                  <button
                    onClick={() => setConversationFilter('mine')}
                    className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                      conversationFilter === 'mine'
                        ? 'border-[#8CD955] text-[#8CD955]'
                        : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                    }`}
                  >
                    Todos ({mineCount})
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

              {activeBroadcastJobId && activeBroadcastProgress && (
                <div
                  className="flex-shrink-0 mx-3 mt-2 mb-1 p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                  onClick={() => setActiveView('broadcast')}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Megaphone className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                    <span className="text-xs font-medium text-blue-700 dark:text-blue-300">Disparo em andamento</span>
                    <span className="ml-auto text-[10px] text-blue-500">
                      {activeBroadcastProgress.current}/{activeBroadcastProgress.total}
                    </span>
                  </div>
                  <div className="h-1 bg-blue-200 dark:bg-blue-900 rounded-full">
                    <div
                      className="h-1 rounded-full transition-all bg-blue-500"
                      style={{ width: `${activeBroadcastProgress.total > 0 ? Math.round((activeBroadcastProgress.current / activeBroadcastProgress.total) * 100) : 0}%` }}
                    />
                  </div>
                  {activeBroadcastCountdown > 0 && (
                    <p className="text-[10px] text-blue-400 mt-0.5">Próximo envio: {activeBroadcastCountdown}s</p>
                  )}
                  {activeBroadcastProgress.lastSent && (
                    <p className="text-[10px] text-blue-500 truncate mt-0.5">
                      Enviado: {activeBroadcastProgress.lastSent.name || activeBroadcastProgress.lastSent.phone}
                    </p>
                  )}
                </div>
              )}
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
                {conversationsLoading && conversations.length === 0 ? (
                  <div className="p-4 flex items-center justify-center gap-2 text-gray-500 dark:text-gray-400 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Carregando conversas...
                  </div>
                ) : sortedConversations.length === 0 ? (
                  <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
                    {selectedChannel ? (
                      <>
                        {conversationFilter === 'mine'
                          ? 'Nenhuma conversa atribuída para você.'
                          : 'Nenhuma conversa no histórico (template ou resolvidas).'}
                        {(userStatus === 'super_admin' ||
                          userStatus === 'admin' ||
                          userStatus === 'suporte' ||
                          userStatus === 'gerente' ||
                          userStatus === 'consultor') && (
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
                            {conv.profile_pic_url && !conv.is_group ? (
                              <img
                                src={conv.profile_pic_url}
                                alt={conv.title || 'Contato'}
                                className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                              />
                            ) : (
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
                            )}
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
                                      {(conv.tags || []).map((tag) => (
                                        <span
                                          key={tag}
                                          className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
                                        >
                                          {tag}
                                        </span>
                                      ))}
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
                                {conv.attendance_status !== 'resolvido' &&
                                  (userStatus === 'suporte' ||
                                    userStatus === 'admin' ||
                                    userStatus === 'super_admin' ||
                                    userStatus === 'gerente' ||
                                    userStatus === 'consultor') && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleResolveConversationFromList(conv.id);
                                      }}
                                      disabled={closingConversationId === conv.id}
                                      className="mr-2 px-2 py-0.5 text-[11px] font-medium rounded border border-gray-300 dark:border-[#505050] text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#3a3a3a] disabled:opacity-60"
                                      title="Encerrar conversa"
                                    >
                                      {closingConversationId === conv.id ? 'Encerrando...' : 'Encerrar'}
                                    </button>
                                  )}
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
                    {selectedConversation.profile_pic_url && !selectedConversation.is_group ? (
                      <img
                        src={selectedConversation.profile_pic_url}
                        alt={selectedConversation.title || 'Contato'}
                        className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
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
                    )}
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
                    {(userStatus === 'suporte' ||
                      userStatus === 'admin' ||
                      userStatus === 'super_admin' ||
                      userStatus === 'gerente' ||
                      userStatus === 'consultor') && (
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
                                {tagOptions.map((t) => (
                                  <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => handleToggleTag(t.name)}
                                    disabled={updatingTags}
                                    className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-[#333] ${
                                      (selectedConversation.tags || []).includes(t.name)
                                        ? 'text-[#8CD955] font-medium'
                                        : 'text-gray-700 dark:text-gray-200'
                                    }`}
                                  >
                                    <span className="w-4 h-4 rounded border flex items-center justify-center text-xs flex-shrink-0">
                                      {(selectedConversation.tags || []).includes(t.name) ? '✓' : ''}
                                    </span>
                                    {t.name}
                                  </button>
                                ))}
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
                    ) : isWithin24hWindow(selectedConversation) &&
                      (userStatus === 'suporte' ||
                        userStatus === 'admin' ||
                        userStatus === 'super_admin' ||
                        userStatus === 'gerente' ||
                        userStatus === 'consultor') ? (
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
                    <div ref={conversationMenuRef} className="relative">
                      <button
                        type="button"
                        onClick={() => setShowConversationMenu((v) => !v)}
                        className="p-1.5 hover:bg-gray-100 dark:hover:bg-[#333] rounded-md text-gray-500 dark:text-gray-400"
                        aria-label="Mais opções"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {showConversationMenu && (
                        <div className="absolute right-0 top-full mt-1 z-20 w-52 py-1.5 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-lg shadow-lg">
                          <button
                            type="button"
                            onClick={handleEditClientNameFromMenu}
                            className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#333]"
                          >
                            Editar nome do cliente
                          </button>
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
                                  backgroundColor: getConversationColor(
                                    msg.sender_jid || selectedConversation.title
                                  ),
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
                              <MessageContent
                                msg={msg}
                                fromMe={msg.from_me}
                                onMediaClick={(url, type, caption) => setMediaModal({ url, type, caption })}
                                onMediaResolved={(msgId, url) => setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, media_url: url } : m))}
                              />
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

                {/* Card resumo CRM (consultor / gerente) */}
                {crmChatContactsUser &&
                  selectedConversation &&
                  convContact &&
                  convContact.crm_snapshot &&
                  typeof convContact.crm_snapshot === 'object' && (
                    <div className="flex-shrink-0 mx-3 mb-2 p-3 rounded-xl border border-gray-200 dark:border-[#404040] bg-gradient-to-br from-gray-50 to-white dark:from-[#333] dark:to-[#2a2a2a] shadow-sm">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                            Cliente no CRM
                          </p>
                          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                            {convContact.name?.trim() || selectedConversation.title || 'Contato'}
                          </p>
                        </div>
                        {convContact.crm_sync_kind && (
                          <span
                            className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full flex-shrink-0 ${
                              convContact.crm_sync_kind === 'kanban'
                                ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100'
                                : convContact.crm_sync_kind === 'transferred'
                                  ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100'
                                  : 'bg-gray-200 text-gray-800 dark:bg-[#444] dark:text-gray-100'
                            }`}
                          >
                            {convContact.crm_sync_kind === 'kanban'
                              ? 'Kanban'
                              : convContact.crm_sync_kind === 'transferred'
                                ? 'Transferido'
                                : 'Manual'}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-700 dark:text-gray-300">
                        {convContact.crm_snapshot.status != null && convContact.crm_snapshot.status !== '' && (
                          <span>
                            <span className="text-gray-500 dark:text-gray-400">Status:</span>{' '}
                            {convContact.crm_snapshot.status}
                          </span>
                        )}
                        {convContact.crm_snapshot.temperature != null &&
                          convContact.crm_snapshot.temperature !== '' && (
                            <span>
                              <span className="text-gray-500 dark:text-gray-400">Temperatura:</span>{' '}
                              {convContact.crm_snapshot.temperature}
                            </span>
                          )}
                        {convContact.crm_snapshot.banca_name != null &&
                          convContact.crm_snapshot.banca_name !== '' && (
                            <span className="col-span-2 truncate">
                              <span className="text-gray-500 dark:text-gray-400">Banca:</span>{' '}
                              {convContact.crm_snapshot.banca_name}
                            </span>
                          )}
                        {convContact.crm_snapshot.total_depositado != null && (
                          <span>
                            <span className="text-gray-500 dark:text-gray-400">Depositado:</span>{' '}
                            {Number(convContact.crm_snapshot.total_depositado).toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            })}
                          </span>
                        )}
                        {convContact.crm_snapshot.total_apostado != null && (
                          <span>
                            <span className="text-gray-500 dark:text-gray-400">Apostado:</span>{' '}
                            {Number(convContact.crm_snapshot.total_apostado).toLocaleString('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            })}
                          </span>
                        )}
                        {convContact.crm_sync_kind === 'transferred' &&
                          convContact.crm_snapshot.transfer_expires_at != null &&
                          convContact.crm_snapshot.transfer_expires_at !== '' && (
                            <span className="col-span-2 font-semibold text-red-600 dark:text-red-400">
                              <span className="text-gray-500 dark:text-gray-400 font-normal">Prazo:</span>{' '}
                              {formatTransferExpiryDay(convContact.crm_snapshot.transfer_expires_at)}
                              {new Date(convContact.crm_snapshot.transfer_expires_at) < new Date()
                                ? ' (vencido)'
                                : ''}
                            </span>
                          )}
                      </div>
                      {convContact.crm_snapshot.tag_labels && convContact.crm_snapshot.tag_labels.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {convContact.crm_snapshot.tag_labels.map((t) => (
                            <span
                              key={t}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-[#8CD955]/20 text-gray-800 dark:text-gray-100"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
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
                      disabled={
                        uploading ||
                        !selectedChannel ||
                        (selectedChannel.type === 'whatsapp_official' && !canSendFreeMessage)
                      }
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
                        disabled={
                          uploading ||
                          !selectedChannel ||
                          (selectedChannel.type === 'whatsapp_official' && !canSendFreeMessage)
                        }
                        className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#333] disabled:opacity-50"
                        title="Gravar áudio"
                      >
                        <Mic className="w-4 h-4" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => docInputRef.current?.click()}
                      disabled={
                        uploading ||
                        selectedChannel?.type !== 'whatsapp_official' ||
                        !canSendFreeMessage
                      }
                      className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#333] disabled:opacity-50"
                      title="Documento (PDF)"
                    >
                      <FileText className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={
                        uploading ||
                        !selectedChannel ||
                        (selectedChannel.type === 'whatsapp_official' && !canSendFreeMessage)
                      }
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
                          selectedChannel?.type === 'whatsapp_official' && !canSendFreeMessage
                            ? 'Fora da janela 24h. Use template.'
                            : "Digite a mensagem. Shift+Enter = nova linha. '/' = resposta pronta."
                        }
                        rows={2}
                        className="w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-[#404040] rounded-xl bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400 resize-none overflow-y-auto focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] focus:outline-none"
                        style={{ minHeight: '44px', maxHeight: '160px' }}
                        disabled={
                          sending ||
                          (selectedChannel?.type === 'whatsapp_official' && !canSendFreeMessage)
                        }
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
                        disabled={
                          (!messageText.trim() && !attachedMedia) ||
                          sending ||
                          (selectedChannel?.type === 'whatsapp_official' && !canSendFreeMessage)
                        }
                        title={
                          selectedChannel?.type === 'whatsapp_official' && !canSendFreeMessage
                            ? 'Fora da janela 24h'
                            : 'Enviar'
                        }
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

      {showStartConversationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Chamar cliente
              </h3>
              <button
                type="button"
                onClick={() => {
                  if (creatingConversation) return;
                  setShowStartConversationModal(false);
                }}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#333] text-gray-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Número do WhatsApp
                </label>
                <input
                  type="text"
                  value={startConversationPhone}
                  onChange={(e) => setStartConversationPhone(e.target.value)}
                  placeholder="Ex: 81995308525"
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] focus:outline-none"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Digite apenas números com DDD e país, sem espaços.
                </p>
              </div>

              {startConversationError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <p className="text-sm text-red-700 dark:text-red-300">{startConversationError}</p>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowStartConversationModal(false)}
                disabled={creatingConversation}
                className="flex-1 px-4 py-2.5 text-sm font-medium border border-gray-300 dark:border-[#404040] rounded-lg text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#333] transition-colors disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleStartConversation}
                disabled={creatingConversation}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white rounded-lg flex items-center justify-center gap-2 disabled:opacity-60 transition-colors"
                style={{ backgroundColor: '#8CD955' }}
              >
                {creatingConversation ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
                {creatingConversation ? 'Chamando...' : 'Abrir conversa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
