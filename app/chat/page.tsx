'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { withTenantSlug } from '@/lib/utils/tenant-href';
import Layout from '@/components/Layout';
import { DocumentMessageView } from '@/components/chat/DocumentMessageView';
import { mergeAuthInit } from '@/lib/utils/authenticated-fetch';
import Link from '@/components/WhitelabelLink';
import { supabase } from '@/lib/supabase';
import { normalizeBroadcastPhoneDigits } from '@/lib/chat/broadcast-phone';
import {
  isActiveInboxConversation,
  isWithin24hWindow as isWithin24hWindowInbox,
  sortConversationsForInbox,
} from '@/lib/chat/conversation-inbox';
import { zapInput } from '@/lib/zap-card-styles';
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
  Workflow,
  Zap,
  Upload,
  StopCircle,
  RotateCcw,
  Radio,
} from 'lucide-react';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface Message {
  id: string;
  message_id?: string;
  text: string | null;
  direction: 'in' | 'out';
  status: string;
  timestamp: number;
  created_at: string;
  from_me: boolean;
  instance_id?: string | null;
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
type ActiveView = 'chat' | 'contacts' | 'agente-ia' | 'broadcast';

const CONV_SESSION_PREFIX = 'zaploto_chat_conv_v1_';
const CONV_SESSION_TTL_MS = 3 * 60 * 1000;

function readSessionConversations(channelId: string): Conversation[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(`${CONV_SESSION_PREFIX}${channelId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; list: Conversation[] };
    if (!parsed?.list?.length || Date.now() - parsed.at > CONV_SESSION_TTL_MS) return null;
    return parsed.list;
  } catch {
    return null;
  }
}

function writeSessionConversations(channelId: string, list: Conversation[]) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(
      `${CONV_SESSION_PREFIX}${channelId}`,
      JSON.stringify({ at: Date.now(), list: list.slice(0, 250) })
    );
  } catch {
    /* quota / private mode */
  }
}

interface FlowOption {
  id: string;
  name: string;
  description?: string;
  status: string;
}

interface ChatInstanceFlow {
  id: string;
  instance_id: string;
  is_active: boolean;
  flows: FlowOption;
}

interface BroadcastContact {
  phone: string;
  name?: string;
}

interface BroadcastMessageConfig {
  type: 'text' | 'audio' | 'video' | 'image' | 'document';
  content?: string;
  attachment_url?: string;
  mimetype?: string;
  caption?: string;
  fileName?: string;
}

interface BroadcastJob {
  id: string;
  title: string;
  instance_name: string;
  total_count: number;
  current_index: number;
  delay_seconds: number;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  started_at?: string | null;
  completed_at?: string | null;
  last_error?: string | null;
  created_at: string;
}

interface CrmMessage {
  id: string;
  title: string;
  content?: string;
  message_type?: string;
  attachment_url?: string;
  preview?: string;
}

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
      className="absolute bottom-full left-0 mb-2 w-72 zap-chat-panel border border-[#E86A24]/12 rounded-xl shadow-xl z-30 overflow-hidden"
    >
      <div className="flex border-b border-[#E86A24]/10">
        {EMOJI_CATEGORIES.map((cat, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActiveTab(i)}
            className={`flex-1 py-2 text-base hover:bg-[#E86A24]/10 transition-colors ${activeTab === i ? 'bg-gray-100 dark:bg-[#333]' : ''}`}
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
            className="text-xl p-1 rounded hover:bg-[#E86A24]/10 transition-colors"
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
  const [failed, setFailed] = useState(false);
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
        {failed ? (
          <div className="rounded-lg bg-white/10 px-6 py-5 text-center text-sm text-white">
            Não foi possível abrir esta mídia.
          </div>
        ) : type === 'image' ? (
          <img
            src={url}
            alt={caption ?? 'imagem'}
            className="max-w-[90vw] max-h-[80vh] rounded-lg object-contain"
            onError={() => setFailed(true)}
          />
        ) : (
          <video
            src={url}
            controls
            autoPlay
            className="max-w-[90vw] max-h-[80vh] rounded-lg"
            onError={() => setFailed(true)}
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
  userId,
  onResolved,
}: {
  chatMessageId: string;
  mediaType: string;
  fromMe: boolean;
  userId?: string | null;
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
      const res = await fetch(
        '/api/chat/messages/retry-media',
        mergeAuthInit(userId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_message_id: chatMessageId }),
        })
      );
      const json = await res.json();
      if (json.success && json.data?.media_url) {
        onResolved(json.data.media_url);
      } else {
        if (json.error || json.message) console.error('[Chat] Retry de mídia falhou:', json.error || json.message);
        setError('Não foi possível recuperar a mídia.');
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
  const [elementError, setElementError] = useState(false);
  const barCount = 36;

  // Carregar duração e waveform ao montar
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !src) return;

    setElementError(false);
    setLoading(true);

    const onLoadedMetadata = () => {
      setElementError(false);
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onEnded = () => setPlaying(false);
    const onAudioError = () => {
      setElementError(true);
      setLoading(false);
    };

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onAudioError);

    (async () => {
      try {
        const res = await fetch(src, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error(String(res.status));
        const buf = await res.arrayBuffer();
        const ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(buf);
        const channel = decoded.getChannelData(0);
        const blockSize = Math.max(1, Math.floor(channel.length / barCount));
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
      audio.removeEventListener('error', onAudioError);
    };
  }, [src]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || elementError) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    void audio
      .play()
      .then(() => setPlaying(true))
      .catch(() => {
        setElementError(true);
        setPlaying(false);
      });
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
      <audio ref={audioRef} src={src} preload="metadata" crossOrigin="anonymous" />
      <button
        type="button"
        onClick={togglePlay}
        disabled={elementError}
        className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center shadow-md disabled:opacity-40 disabled:cursor-not-allowed ${fromMe ? 'bg-white/20 hover:bg-white/30 text-white' : 'bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-800 dark:text-gray-100'}`}
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
        {elementError && (
          <p className={`text-[10px] leading-snug ${fromMe ? 'text-white/75' : 'text-red-500 dark:text-red-400'}`}>
            Áudio não reproduziu (rede ou formato). Se a mensagem tiver a opção, use &quot;Tentar baixar novamente&quot;.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── MessageContent ────────────────────────────────────────────────────────────

function MessageContent({
  msg,
  fromMe,
  userId,
  onMediaClick,
  onMediaResolved,
}: {
  msg: Message;
  fromMe: boolean;
  userId?: string | null;
  onMediaClick: (url: string, type: 'image' | 'video', caption?: string | null) => void;
  onMediaResolved?: (messageId: string, url: string) => void;
}) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [failedMedia, setFailedMedia] = useState<'image' | 'video' | null>(null);
  const mediaUrl = resolvedUrl || msg.media_url;
  const displayMediaUrl = mediaUrl
    ? `/api/chat/messages/download-media?chat_message_id=${encodeURIComponent(msg.id)}`
    : null;
  const textClass = fromMe ? 'text-white/90' : 'text-gray-600 dark:text-gray-300';

  const handleMediaResolved = (url: string) => {
    setFailedMedia(null);
    setResolvedUrl(url);
    onMediaResolved?.(msg.id, url);
  };

  // Auto-retry: mídia oficial sem URL (webhook salvou antes do download). Áudio: 2 tentativas com intervalo maior (Meta/Storage lentos).
  useEffect(() => {
    if (mediaUrl) return;
    const isOfficial =
      msg.provider === 'whatsapp_official' ||
      (!!msg.whatsapp_config_id && msg.instance_id == null);
    if (!isOfficial) return;
    if (!msg.media_type || msg.media_type === 'text') return;

    const delays =
      msg.media_type === 'audio'
        ? [2000, 9000]
        : msg.media_type === 'document'
          ? [1500, 5000]
          : [1500];
    const timers: ReturnType<typeof setTimeout>[] = [];

    const run = async () => {
      try {
        const res = await fetch(
          '/api/chat/messages/retry-media',
          mergeAuthInit(userId, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_message_id: msg.id }),
          })
        );
        const json = await res.json();
        if (json.success && json.data?.media_url) {
          handleMediaResolved(json.data.media_url);
        }
      } catch {
        // silencioso — retry manual continua disponível
      }
    };

    for (const ms of delays) {
      timers.push(setTimeout(() => void run(), ms));
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaUrl, msg.id, msg.provider, msg.media_type, msg.whatsapp_config_id, msg.instance_id, userId]);

  const canRetry =
    msg.provider === 'whatsapp_official' ||
    (!!msg.whatsapp_config_id && msg.instance_id == null);

  const retryFallback = (mediaType: string) =>
    canRetry ? (
      <MediaRetryButton
        chatMessageId={msg.id}
        mediaType={mediaType}
        fromMe={fromMe}
        userId={userId}
        onResolved={handleMediaResolved}
      />
    ) : null;

  return (
    <div className="space-y-1">
      {msg.media_type === 'image' && (
        displayMediaUrl && failedMedia !== 'image' ? (
          <img
            src={displayMediaUrl}
            alt={msg.caption ?? 'imagem'}
            className="rounded-lg max-w-xs max-h-64 object-cover cursor-pointer"
            onClick={() => onMediaClick(displayMediaUrl, 'image', msg.caption)}
            onError={() => setFailedMedia('image')}
          />
        ) : (
          retryFallback('image') || <span className={`text-sm italic ${textClass}`}>📷 Imagem não disponível</span>
        )
      )}
      {msg.media_type === 'audio' && (
        displayMediaUrl && failedMedia !== 'video' ? (
          <AudioMessagePlayer src={displayMediaUrl} fromMe={fromMe} />
        ) : (
          retryFallback('audio') || <span className={`text-sm italic ${textClass}`}>🎵 Áudio não disponível</span>
        )
      )}
      {msg.media_type === 'video' && (
        displayMediaUrl && failedMedia !== 'video' ? (
          <div className="relative cursor-pointer group max-w-xs" onClick={() => onMediaClick(displayMediaUrl, 'video', msg.caption)}>
            <video
              src={displayMediaUrl}
              className="rounded-lg max-w-xs max-h-64 pointer-events-none"
              onError={() => setFailedMedia('video')}
            />
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
          <DocumentMessageView
            url={mediaUrl}
            caption={msg.caption}
            fromMe={fromMe}
            chatMessageId={msg.id}
            userId={userId}
          />
        ) : (
          retryFallback('document') || <span className={`text-sm italic ${textClass}`}>📄 Documento não disponível</span>
        )
      )}
      {msg.caption && msg.media_type && msg.media_type !== 'text' && msg.media_type !== 'document' && (
        <p className={`text-sm mt-1 ${textClass}`}>{msg.caption}</p>
      )}
      {(!msg.media_type || msg.media_type === 'text') && msg.text != null && msg.text !== '' && (
        <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>
      )}
    </div>
  );
}

type UserStatus = 'super_admin' | 'admin' | string | null;

const CONVERSATIONS_PAGE_SIZE = 10;
const MESSAGES_PAGE_SIZE = 50;

/** Alinhado a app/api/chat/send — instância Evolution indisponível ao enviar. */
const EVOLUTION_INSTANCE_UNREACHABLE_CODE = 'EVOLUTION_INSTANCE_UNREACHABLE';

type EvolutionSendApiResult = {
  success?: boolean;
  error?: string;
  message?: string;
  code?: string;
  data?: unknown;
};

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
  /** Aviso global quando a instância Evolution cai no envio (ex.: Connection Closed). */
  const [evolutionInstanceNotice, setEvolutionInstanceNotice] = useState<string | null>(null);

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
  const initialScrollPendingRef = useRef(false);

  // Envio
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [retryingAudioMessageId, setRetryingAudioMessageId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [attachedMedia, setAttachedMedia] = useState<{
    url: string;
    type: 'image' | 'audio' | 'video' | 'document';
    name: string;
    preview?: string;
    mimetype?: string;
    meta_id?: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState<number | null>(null);
  const [videoUploadStage, setVideoUploadStage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Cache de conversas por canal — permite exibição imediata ao trocar de canal
  const conversationsCacheRef = useRef<Record<string, Conversation[]>>({});

  // Backfill leve de eventos pendentes (adiado — não compete com a lista inicial)
  const waSyncedChannelsRef = useRef<Set<string>>(new Set());
  const evoSyncedChannelsRef = useRef<Set<string>>(new Set());
  const deferredSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commitConversations = useCallback((channelId: string, list: Conversation[]) => {
    const sorted = sortConversationsForInbox(list) as Conversation[];
    conversationsCacheRef.current[channelId] = sorted;
    writeSessionConversations(channelId, sorted);
    const el = conversationListScrollRef.current;
    const savedScroll = el?.scrollTop ?? 0;
    setConversations(sorted);
    setConversationsLoading(false);
    if (savedScroll > 0) {
      requestAnimationFrame(() => {
        if (el) el.scrollTop = savedScroll;
      });
    }
  }, []);
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
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedBlobUrl, setRecordedBlobUrl] = useState<string | null>(null);
  const [recordedMimeType, setRecordedMimeType] = useState<string>('audio/ogg');

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
  const [deleteConfirm, setDeleteConfirm] = useState<{ messageId: string; isOfficialApi: boolean } | null>(null);

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

  // ── Agente IA ───────────────────────────────────────────────────────────────
  const [availableFlows, setAvailableFlows] = useState<FlowOption[]>([]);
  const [instanceFlow, setInstanceFlow] = useState<ChatInstanceFlow | null>(null);
  const [loadingFlows, setLoadingFlows] = useState(false);
  const [savingFlowConfig, setSavingFlowConfig] = useState(false);
  const [selectedFlowId, setSelectedFlowId] = useState<string>('');

  // ── Disparo em Massa ────────────────────────────────────────────────────────
  const [broadcastJobs, setBroadcastJobs] = useState<BroadcastJob[]>([]);
  const [broadcastJob, setBroadcastJob] = useState<BroadcastJob | null>(null);
  const [broadcastRunning, setBroadcastRunning] = useState(false);
  const broadcastAbortRef = useRef(false);
  // Contatos para disparo
  const [broadcastContacts, setBroadcastContacts] = useState<BroadcastContact[]>([]);
  const [broadcastCsvFileName, setBroadcastCsvFileName] = useState('');
  // Mensagem selecionada do CRM
  const [crmMessages, setCrmMessages] = useState<CrmMessage[]>([]);
  const [selectedCrmMessage, setSelectedCrmMessage] = useState<CrmMessage | null>(null);
  const [loadingCrmMessages, setLoadingCrmMessages] = useState(false);
  // Configuração do disparo
  const [broadcastDelay, setBroadcastDelay] = useState(30);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastCreating, setBroadcastCreating] = useState(false);
  // Progresso em tempo real
  const [broadcastProgress, setBroadcastProgress] = useState<{ current: number; total: number } | null>(null);
  const [broadcastLog, setBroadcastLog] = useState<Array<{ phone: string; name?: string; success: boolean; error?: string }>>([]);
  const broadcastLogRef = useRef<HTMLDivElement>(null);

  const authHeaders = (): Record<string, string> => (userId ? { 'X-User-Id': userId } : {});
  const canSelectChannel =
    userStatus === 'super_admin' || userStatus === 'admin';

  const handleSignOut = async () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
    }
    window.location.href = withTenantSlug('/login');
  };

  // ── Agente IA: carregar flows disponíveis quando abre o painel ──────────────
  const loadFlowsForAI = useCallback(async () => {
    if (!userId) return;
    setLoadingFlows(true);
    try {
      const res = await fetch('/api/flows', { headers: authHeaders() });
      const json = await res.json();
      if (json.success) setAvailableFlows(json.data || []);
    } catch { /* silencioso */ } finally {
      setLoadingFlows(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const loadInstanceFlow = useCallback(async (instanceId: string) => {
    if (!userId || !instanceId) return;
    try {
      const res = await fetch(`/api/chat/flow-config?instance_id=${instanceId}`, { headers: authHeaders() });
      const json = await res.json();
      if (json.success && json.data) {
        setInstanceFlow(json.data as ChatInstanceFlow);
        setSelectedFlowId(json.data.flows?.id ?? '');
      } else {
        setInstanceFlow(null);
        setSelectedFlowId('');
      }
    } catch { /* silencioso */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const saveFlowConfig = useCallback(async () => {
    if (!userId || !selectedChannel || selectedChannel.type !== 'evolution') return;
    setSavingFlowConfig(true);
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
      const json = await res.json();
      if (json.success) setInstanceFlow(json.data);
    } catch { /* silencioso */ } finally {
      setSavingFlowConfig(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, selectedChannel, selectedFlowId]);

  // ── Disparo em Massa: funções ────────────────────────────────────────────────
  const loadCrmMessages = useCallback(async () => {
    if (!userId) return;
    setLoadingCrmMessages(true);
    try {
      const res = await fetch('/api/crm/messages', { headers: authHeaders() });
      const json = await res.json();
      if (json.success) setCrmMessages(json.data || []);
    } catch { /* silencioso */ } finally {
      setLoadingCrmMessages(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const loadBroadcastJobs = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch('/api/chat/broadcast', { headers: authHeaders() });
      const json = await res.json();
      if (json.success) setBroadcastJobs(json.data || []);
    } catch { /* silencioso */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const parseBroadcastCsv = useCallback((raw: string): BroadcastContact[] => {
    const firstLine = raw.split(/\r?\n/)[0] || '';
    const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length < 2) return [];
    const header = lines[0].split(delimiter).map((h) => h.trim().toLowerCase());
    const phoneCandidates = ['telefone','phone','phone_number','number','celular','mobile','whatsapp','tel','fone'];
    const nameCandidates = ['name','nome','full_name','fullname','contact_name','contact'];
    const telIdx = header.findIndex((h) => phoneCandidates.includes(h));
    const nameIdx = header.findIndex((h) => nameCandidates.includes(h));
    if (telIdx < 0) return [];
    const contacts: BroadcastContact[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(delimiter);
      const digits = (cols[telIdx] || '').replace(/\D/g, '');
      if (!digits || digits.length < 8) continue;
      const phone = normalizeBroadcastPhoneDigits(digits);
      if (phone.length < 8) continue;
      contacts.push({ phone, name: nameIdx >= 0 ? (cols[nameIdx] || '').trim() : undefined });
    }
    return contacts;
  }, []);

  const startBroadcast = useCallback(async () => {
    if (!userId || !selectedChannel || selectedChannel.type !== 'evolution') return;
    if (!selectedCrmMessage) return;
    if (broadcastContacts.length === 0) return;
    setBroadcastCreating(true);
    try {
      const msgConfig: BroadcastMessageConfig = {
        type: (selectedCrmMessage.message_type as BroadcastMessageConfig['type']) || 'text',
        content: selectedCrmMessage.content,
        attachment_url: selectedCrmMessage.attachment_url,
        caption: selectedCrmMessage.content?.substring(0, 100),
      };
      const res = await fetch('/api/chat/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          instance_id: selectedChannel.id,
          title: broadcastTitle || `Disparo ${selectedCrmMessage.title}`,
          message_config: msgConfig,
          contacts: broadcastContacts,
          delay_seconds: broadcastDelay,
        }),
      });
      const json = await res.json();
      if (json.success && json.data?.id) {
        setBroadcastJob(json.data as BroadcastJob);
        setBroadcastProgress({ current: 0, total: broadcastContacts.length });
        setBroadcastLog([]);
        broadcastAbortRef.current = false;
        runBroadcast(json.data.id, broadcastContacts.length);
      }
    } catch { /* silencioso */ } finally {
      setBroadcastCreating(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, selectedChannel, selectedCrmMessage, broadcastContacts, broadcastDelay, broadcastTitle]);

  const runBroadcast = useCallback(async (jobId: string, totalCount: number) => {
    setBroadcastRunning(true);
    broadcastAbortRef.current = false;
    // Marca como running
    await fetch(`/api/chat/broadcast/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ status: 'running' }),
    }).catch(() => {});

    let instanceDownRetries = 0;
    const MAX_DOWN_RETRIES = 5;

    while (!broadcastAbortRef.current) {
      let nextWaitMs = (broadcastDelay || 30) * 1000;
      try {
        const res = await fetch(`/api/chat/broadcast/${jobId}/process-next`, {
          method: 'POST',
          headers: authHeaders(),
        });
        const json = await res.json();
        const d = json.data as {
          done?: boolean;
          paused?: boolean;
          instanceDown?: boolean;
          skipped?: boolean;
          success?: boolean;
          contact?: { phone: string; name?: string };
          current_index?: number;
          total_count?: number;
          error?: string;
          next_delay_seconds?: number;
          duplicateSuppressed?: boolean;
        };

        if (d?.paused) { setBroadcastRunning(false); break; }
        if (d?.done) {
          setBroadcastProgress({ current: totalCount, total: totalCount });
          setBroadcastRunning(false);
          loadBroadcastJobs();
          break;
        }
        if (d?.instanceDown) {
          instanceDownRetries++;
          setBroadcastLog((prev) => [...prev, { phone: '—', success: false, error: `Instância offline (tentativa ${instanceDownRetries})` }]);
          if (instanceDownRetries >= MAX_DOWN_RETRIES) {
            // Pausa após muitas tentativas com instância offline
            await fetch(`/api/chat/broadcast/${jobId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', ...authHeaders() },
              body: JSON.stringify({ status: 'paused' }),
            }).catch(() => {});
            setBroadcastRunning(false);
            break;
          }
          // Espera 30s e tenta de novo
          await new Promise((r) => setTimeout(r, 30000));
          continue;
        }

        instanceDownRetries = 0;
        if (d?.current_index !== undefined) {
          setBroadcastProgress({ current: d.current_index, total: d.total_count ?? totalCount });
        }
        if (d?.contact || d?.skipped) {
          setBroadcastLog((prev) => [
            ...prev,
            {
              phone: d.contact?.phone ?? '—',
              name: d.contact?.name,
              success: d.success ?? false,
              error: d.error,
            },
          ]);
          // Auto-scroll do log
          setTimeout(() => { broadcastLogRef.current?.scrollTo({ top: 99999, behavior: 'smooth' }); }, 50);
        }
        // Recarrega conversas para mostrar em tempo real no chat
        if (d?.success) {
          loadConversationsFromApi(false).catch(() => {});
        }
        if (d?.duplicateSuppressed) {
          nextWaitMs = 0;
        } else if (typeof d?.next_delay_seconds === 'number' && d.next_delay_seconds >= 0) {
          nextWaitMs = d.next_delay_seconds * 1000;
        } else {
          nextWaitMs = (broadcastDelay || 30) * 1000;
        }
      } catch { /* falha de rede — continua */ }

      if (!broadcastAbortRef.current) {
        await new Promise((r) => setTimeout(r, nextWaitMs));
      }
    }
    setBroadcastRunning(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcastDelay, loadBroadcastJobs]);

  const pauseBroadcast = useCallback(async () => {
    if (!broadcastJob) return;
    broadcastAbortRef.current = true;
    await fetch(`/api/chat/broadcast/${broadcastJob.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ status: 'paused' }),
    }).catch(() => {});
    setBroadcastRunning(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcastJob]);

  const resumeBroadcast = useCallback(async () => {
    if (!broadcastJob) return;
    broadcastAbortRef.current = false;
    setBroadcastRunning(true);
    runBroadcast(broadcastJob.id, broadcastJob.total_count);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcastJob, runBroadcast]);

  const cancelBroadcast = useCallback(async () => {
    if (!broadcastJob) return;
    broadcastAbortRef.current = true;
    await fetch(`/api/chat/broadcast/${broadcastJob.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ status: 'cancelled' }),
    }).catch(() => {});
    setBroadcastRunning(false);
    setBroadcastJob(null);
    loadBroadcastJobs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcastJob, loadBroadcastJobs]);

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
            const instant =
              readSessionConversations(defaultChannel.id) ||
              conversationsCacheRef.current[defaultChannel.id];
            if (instant?.length) {
              commitConversations(defaultChannel.id, instant);
            }
            setSelectedChannel(defaultChannel);
            setConversationFilter('all');
          }
          // Pré-carrega: WhatsApp Oficial primeiro (canal padrão), depois Evolution
          const orderedChannels: Array<{ id: string; type: 'evolution' | 'whatsapp_official' }> = [
            ...wa.map((c) => ({ id: c.id, type: 'whatsapp_official' as const })),
            ...evo.map((c) => ({ id: c.id, type: 'evolution' as const })),
          ];
          orderedChannels.forEach(({ id, type }) => {
            const params = type === 'evolution' ? `instance_id=${id}` : `whatsapp_config_id=${id}`;
            fetch(`/api/chat/conversations?${params}`, { headers: authHeaders() })
              .then((r) => r.json())
              .then((res) => {
                if (res.success) {
                  const list: Conversation[] = res.data || [];
                  conversationsCacheRef.current[id] = sortConversationsForInbox(list) as Conversation[];
                  setSelectedChannel((ch) => {
                    if (ch?.id === id) commitConversations(id, list);
                    return ch;
                  });
                }
              })
              .catch(() => {});
          });
        }
      })
      .catch((e) => console.error('[Chat] canais:', e));
  }, [userId, commitConversations]);

  // ── Carregar Conversas ─────────────────────────────────────────────────────
  const loadConversationsFromApi = useCallback(
    async (keepSelectionIfPresent = false) => {
      if (!selectedChannel) return;
      const channelId = selectedChannel.id;

      const instant =
        conversationsCacheRef.current[channelId] || readSessionConversations(channelId);
      if (instant?.length) {
        commitConversations(channelId, instant);
      } else {
        setConversationsLoading(true);
      }

      try {
        const params =
          selectedChannel.type === 'evolution'
            ? `instance_id=${channelId}`
            : `whatsapp_config_id=${channelId}`;

        const response = await fetch(`/api/chat/conversations?${params}`, { headers: authHeaders() });
        const result = await response.json();
        if (result.success) {
          const list: Conversation[] = result.data || [];
          commitConversations(channelId, list);
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
    [selectedChannel, commitConversations]
  );

  /** Uma página de eventos pendentes — só após a lista já estar na tela (não compete com o GET). */
  const runDeferredPendingSync = useCallback(
    async (channel: Channel) => {
      try {
        if (channel.type === 'whatsapp_official') {
          if (waSyncedChannelsRef.current.has(channel.id)) return;
          waSyncedChannelsRef.current.add(channel.id);
          const res = await fetch('/api/chat/webhook-events/process-pending', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ limit: 80, offset: 0 }),
          });
          const json = await res.json();
          if (json.data?.token_alert) {
            setShowTokenAlert(true);
            setTokenAlertMessage(
              json.data.token_alert_message ||
                'Token de acesso inválido ou expirado. Renove o token em Admin > WhatsApp Oficial.'
            );
          }
        } else if (channel.type === 'evolution') {
          if (evoSyncedChannelsRef.current.has(channel.id)) return;
          evoSyncedChannelsRef.current.add(channel.id);
          const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
          await fetch('/api/chat/evolution-events/process-pending', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({
              instance_name: channel.instance_name,
              limit: 80,
              offset: 0,
              since: sinceIso,
            }),
          });
        }
        await loadConversationsFromApi(false);
      } catch (err) {
        console.error('[Chat] deferred pending sync:', err);
      }
    },
    [loadConversationsFromApi]
  );

  useEffect(() => {
    if (!selectedChannel) return;

    setConversationFilter('all');
    if (conversationListScrollRef.current) conversationListScrollRef.current.scrollTop = 0;

    const instant =
      readSessionConversations(selectedChannel.id) ||
      conversationsCacheRef.current[selectedChannel.id];
    if (instant?.length) {
      commitConversations(selectedChannel.id, instant);
    }

    void loadConversationsFromApi(false);

    if (deferredSyncTimerRef.current) clearTimeout(deferredSyncTimerRef.current);
    deferredSyncTimerRef.current = setTimeout(() => {
      void runDeferredPendingSync(selectedChannel);
    }, 12_000);

    return () => {
      if (deferredSyncTimerRef.current) {
        clearTimeout(deferredSyncTimerRef.current);
        deferredSyncTimerRef.current = null;
      }
    };
  }, [selectedChannel, loadConversationsFromApi, runDeferredPendingSync, commitConversations]);

  // Etiquetas disponíveis (criadas pelo admin) para filtro e para marcar conversas
  useEffect(() => {
    if (!userId || !(userStatus === 'admin' || userStatus === 'super_admin')) return;
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
      if (userStatus === 'admin' || userStatus === 'super_admin') {
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
    initialScrollPendingRef.current = true;

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
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      const container = messagesContainerRef.current;
      if (container) container.scrollTop = container.scrollHeight;
      secondFrame = requestAnimationFrame(() => {
        const current = messagesContainerRef.current;
        if (current) current.scrollTop = current.scrollHeight;
        initialScrollPendingRef.current = false;
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [selectedConversationId, messagesLoading]);

  // Handler de scroll das mensagens: topo → carrega mais antigas
  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container || initialScrollPendingRef.current || !hasOlderMessages || loadingOlderMessages) return;
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
            loadConversationsFromApi(true);
          }
          if (res.data?.token_alert) {
            setShowTokenAlert(true);
            setTokenAlertMessage(res.data.token_alert_message || 'Token de acesso inválido ou expirado. Renove o token em Admin > WhatsApp Oficial.');
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
    const canNotify = userStatus === 'super_admin' || userStatus === 'admin';

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
              const existingIdx = prev.findIndex((c) => c.id === newConv.id);
              let result: Conversation[];
              if (existingIdx >= 0) {
                // Atualiza dado in-place sem reordenar para não pular a posição do scroll
                result = prev.map((c) => (c.id === newConv.id ? newConv : c));
              } else {
                // Nova conversa: insere no topo e ordena
                result = sortConversationsForInbox([newConv, ...prev]) as Conversation[];
              }
              conversationsCacheRef.current[filterVal] = result;
              writeSessionConversations(filterVal, result);
              return result;
            });

            if (isNew && canNotify && typeof window !== 'undefined' && 'Notification' in window) {
              const convTitle = newConv.title || 'Nova conversa';
              const preview = (newConv.last_message_preview || '').slice(0, 60);
              if (document.visibilityState === 'hidden' && Notification.permission === 'granted') {
                try {
                  new Notification('Nova conversa no Chat — crm-atendimento', {
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

  // ── Agente IA: carrega flows e config da instância ao abrir o painel ────────
  useEffect(() => {
    if (activeView !== 'agente-ia') return;
    loadFlowsForAI();
    if (selectedChannel?.type === 'evolution') loadInstanceFlow(selectedChannel.id);
  }, [activeView, selectedChannel, loadFlowsForAI, loadInstanceFlow]);

  // ── Disparo em Massa: carrega mensagens do CRM ao abrir o painel ─────────
  useEffect(() => {
    if (activeView !== 'broadcast') return;
    loadCrmMessages();
    loadBroadcastJobs();
  }, [activeView, loadCrmMessages, loadBroadcastJobs]);

  // ── Realtime: progresso do broadcast ────────────────────────────────────────
  useEffect(() => {
    if (!userId || !broadcastJob) return;
    const ch = supabase
      .channel(`chat_broadcast_${broadcastJob.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_broadcasts',
        filter: `id=eq.${broadcastJob.id}`,
      }, (payload) => {
        const updated = payload.new as BroadcastJob;
        setBroadcastJob(updated);
        setBroadcastProgress({ current: updated.current_index, total: updated.total_count });
        if (updated.status === 'completed' || updated.status === 'cancelled') {
          setBroadcastRunning(false);
          loadBroadcastJobs();
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, broadcastJob, loadBroadcastJobs]);

  // ── Permissão de notificação ───────────────────────────────────────────────
  useEffect(() => {
    const canNotify = userStatus === 'super_admin' || userStatus === 'admin';
    if (!canNotify || typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  }, [userStatus]);

  // ── Upload de arquivo ──────────────────────────────────────────────────────
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedChannel || selectedChannel.type !== 'whatsapp_official') return;
    if (attachedMedia?.preview) URL.revokeObjectURL(attachedMedia.preview);
    setAttachedMedia(null);
    const isVideo = (file.type || '').split(';')[0].toLowerCase() === 'video/mp4';
    let progressTimer: ReturnType<typeof setInterval> | null = null;
    if (isVideo) {
      setVideoUploadProgress(3);
      setVideoUploadStage('Enviando vídeo ao servidor…');
      progressTimer = setInterval(() => {
        setVideoUploadProgress((current) => {
          if (current == null) return null;
          if (current >= 96) {
            setVideoUploadStage('Finalizando o vídeo e enviando ao WhatsApp…');
            return 96;
          }
          if (current >= 28) {
            setVideoUploadStage('Comprimindo e preparando para o WhatsApp…');
            return Math.min(96, current + (current >= 88 ? 0.25 : 1));
          }
          return current + 3;
        });
      }, 700);
    }
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
      if (!res.ok || !data.success) {
        alert(data.error || data.message || 'Falha no upload');
        return;
      }
      if (isVideo) {
        setVideoUploadProgress(100);
        setVideoUploadStage(
          data.data.compressed ? 'Vídeo comprimido e pronto para envio.' : 'Vídeo pronto para envio.'
        );
      }
      const preview = data.data.media_type === 'image' ? URL.createObjectURL(file) : undefined;
      setAttachedMedia({
        url: data.data.url,
        type: data.data.media_type,
        name: file.name,
        preview,
        meta_id: data.data.meta_id,
        mimetype: data.data.mime_type,
      });
    } catch (err) {
      console.error('[Chat] upload:', err);
      alert('Falha ao enviar arquivo');
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      setUploading(false);
      if (isVideo) {
        setTimeout(() => {
          setVideoUploadProgress(null);
          setVideoUploadStage('');
        }, 1200);
      }
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
    if (selectedChannel.type === 'whatsapp_official' && !canSendFreeMessage) {
      alert('Fora da janela de 24h. Use mensagem template para iniciar ou reabrir a conversa.');
      return;
    }
    if (!userId) {
      alert('Faça login para gravar áudio.');
      return;
    }
    // Descarta gravação anterior pendente
    if (recordedBlobUrl) URL.revokeObjectURL(recordedBlobUrl);
    setRecordedBlob(null);
    setRecordedBlobUrl(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getPreferredAudioMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: mimeType });
        const previewUrl = URL.createObjectURL(blob);
        setRecordedBlob(blob);
        setRecordedBlobUrl(previewUrl);
        setRecordedMimeType(mimeType);
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

  const discardRecordedAudio = () => {
    if (recordedBlobUrl) URL.revokeObjectURL(recordedBlobUrl);
    setRecordedBlob(null);
    setRecordedBlobUrl(null);
  };

  const uploadRecordedAudio = async (
    blob: Blob,
    mimeType: string
  ): Promise<{ meta_id?: string; url: string; metaError?: string } | null> => {
    if (!selectedChannel || !userId) return null;
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
          return null;
        }
        return { url: uploadData.data.url, meta_id: undefined };
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

      // Supabase primeiro (preview no chat); Meta em seguida (media_id para envio confiável)
      const supRes = await fetch('/api/chat/whatsapp-official/upload-media', {
        method: 'POST',
        body: makeFormData(),
        headers: authHeaders(),
      });
      const supData = await supRes.json();
      const url: string = supData?.success ? supData.data?.url : '';

      let meta_id: string | undefined;
      let metaError: string | undefined;
      try {
        const metaRes = await fetch('/api/chat/whatsapp-official/upload-audio-meta', {
          method: 'POST',
          body: makeFormData(),
          headers: authHeaders(),
        });
        const metaData = await metaRes.json();
        if (metaData?.success && metaData.data?.media_id) {
          meta_id = metaData.data.media_id;
        } else {
          metaError = metaData?.error || metaData?.message || `HTTP ${metaRes.status}`;
        }
      } catch (e) {
        metaError = (e as Error)?.message || 'Falha no upload para Meta';
      }

      if (!meta_id && !url) {
        console.error('[Chat] upload áudio:', metaError);
        return null;
      }

      return { meta_id, url, metaError: meta_id ? undefined : metaError };
    } catch (e) {
      console.error('[Chat] upload áudio:', e);
      return null;
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

  const requestDeleteMessage = (messageRowId: string) => {
    if (deletingMessageId) return;
    const isOfficialApi = selectedChannel?.type === 'whatsapp_official';
    if (isOfficialApi) {
      setDeleteConfirm({ messageId: messageRowId, isOfficialApi: true });
    } else {
      executeDeleteMessage(messageRowId);
    }
  };

  const executeDeleteMessage = async (messageRowId: string) => {
    if (deletingMessageId) return;
    setDeleteConfirm(null);
    setDeletingMessageId(messageRowId);
    try {
      const res = await fetch('/api/chat/messages', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ message_id: messageRowId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
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
  const resetChannelAfterEvolutionFailure = (notice: string) => {
    setSendError(null);
    setEvolutionInstanceNotice(notice);
    if (canSelectChannel) {
      setSelectedChannel(null);
      setSelectedConversationId('');
      setConversations([]);
      setMessages([]);
      setChatSidebarOpen(true);
    }
  };

  const getSendErrorMessage = (status: number, bodyError?: string): string => {
    if (bodyError && bodyError.trim()) console.error('[Chat] Envio falhou:', bodyError);
    switch (status) {
      case 502: return 'Serviço temporariamente indisponível. Tente novamente.';
      case 503: return 'Serviço temporariamente indisponível. Selecione outra instância ou aguarde.';
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
    const hasRecordedAudio = !!(recordedBlob && !isRecording);
    if ((!hasText && !hasMedia && !hasRecordedAudio) || !selectedConversationId || !selectedChannel || sending) return;
    if (selectedChannel.type === 'whatsapp_official' && !canSendFreeMessage) {
      setSendError('Fora da janela de 24h. Use mensagem template para iniciar ou reabrir a conversa.');
      return;
    }

    const conversation = conversations.find((c) => c.id === selectedConversationId);
    if (!conversation) return;

    setSendError(null);
    setSending(true);
    try {
      if (hasRecordedAudio) {
        const uploaded = await uploadRecordedAudio(recordedBlob!, recordedMimeType);
        if (!uploaded) {
          setSendError(
            'Falha ao processar áudio. Se o erro mencionar FFmpeg, instale com: brew install ffmpeg e reinicie o servidor.'
          );
          return;
        }
        if (!uploaded.meta_id && !uploaded.url) {
          setSendError(uploaded.metaError || 'Falha ao enviar áudio para o WhatsApp.');
          return;
        }

        if (selectedChannel.type === 'evolution') {
          const response = await fetch('/api/chat/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({
              instance_id: selectedChannel.id,
              remoteJid: conversation.remote_jid,
              type: 'media',
              media: uploaded.url,
              mimetype: recordedMimeType.split(';')[0].trim() || 'audio/ogg',
              mediatype: 'audio',
              fileName: 'audio.ogg',
            }),
          });
          const result = await response.json().catch(() => ({}));
          if (response.ok && result.success) {
            discardRecordedAudio();
          } else {
            setSendError(result.error || result.message || 'Falha ao enviar áudio.');
          }
          return;
        }

        const to = conversation.remote_jid.replace(/@s\.whatsapp\.net$/, '').replace(/\D/g, '');
        const body: Record<string, string | undefined> = {
          config_id: selectedChannel.id,
          to,
          type: 'audio',
          ...(uploaded.meta_id ? { meta_id: uploaded.meta_id } : {}),
          media_url: uploaded.url || undefined,
        };
        if (!uploaded.meta_id && uploaded.url) {
          console.warn('[Chat] envio de áudio via media_url (Meta upload falhou):', uploaded.metaError);
        }
        const response = await fetch('/api/chat/whatsapp-official/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(body),
        });
        let result: { success?: boolean; error?: string; message?: string } = {};
        try { result = await response.json(); } catch { result = {}; }
        if (response.ok && result.success) {
          discardRecordedAudio();
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
        return;
      }

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
          const saved = (result as { data?: { message?: (Message & { conversation_id?: string }) | null } }).data?.message;
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
              return [...prev, msg];
            });
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
          }
          void loadConversationsFromApi(true);
        } else if (result.code === EVOLUTION_INSTANCE_UNREACHABLE_CODE) {
          resetChannelAfterEvolutionFailure(
            result.error ||
              'A conexão da instância WhatsApp foi encerrada. Selecione outra instância ou reconecte em Instâncias WhatsApp.'
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
              media_mime_type: attachedMedia!.mimetype,
              ...(attachedMedia!.meta_id
                ? { meta_id: attachedMedia!.meta_id, media_url: attachedMedia!.url || undefined }
                : { media_url: attachedMedia!.url }),
              caption: hasText ? messageText.trim() : undefined,
              ...(attachedMedia!.type === 'document'
                ? {
                    filename: attachedMedia!.name,
                    ...(!hasText ? { caption: attachedMedia!.name } : {}),
                  }
                : {}),
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
          const saved = (result as { data?: { message?: (Message & { conversation_id?: string }) | null } }).data?.message;
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
              return [...prev, msg];
            });
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
          }
          void loadConversationsFromApi(true);
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

  const isFailedMessage = (msg: Message) =>
    ['failed', 'error', 'undelivered', 'rejected'].includes(
      String(msg.status ?? '').trim().toLowerCase()
    );

  const retryFailedAudioMessage = async (msg: Message) => {
    if (
      retryingAudioMessageId ||
      !selectedChannel ||
      !selectedConversation ||
      !msg.from_me ||
      msg.media_type !== 'audio' ||
      !isFailedMessage(msg)
    ) return;

    if (selectedChannel.type === 'whatsapp_official' && !canSendFreeMessage) {
      setSendError('Fora da janela de 24h. Use mensagem template para reabrir a conversa.');
      return;
    }

    setSendError(null);
    setRetryingAudioMessageId(msg.id);
    try {
      const mediaResponse = await fetch(
        `/api/chat/messages/download-media?chat_message_id=${encodeURIComponent(msg.id)}&download=1`,
        { headers: authHeaders() }
      );
      if (!mediaResponse.ok) throw new Error('Não foi possível recuperar o áudio original.');

      const audioBlob = await mediaResponse.blob();
      const uploaded = await uploadRecordedAudio(audioBlob, audioBlob.type || 'audio/ogg');
      if (!uploaded || (!uploaded.meta_id && !uploaded.url)) {
        throw new Error(uploaded?.metaError || 'Não foi possível preparar o áudio para reenvio.');
      }

      if (selectedChannel.type === 'evolution') {
        const response = await fetch('/api/chat/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            instance_id: selectedChannel.id,
            remoteJid: selectedConversation.remote_jid,
            type: 'media',
            media: uploaded.url,
            mimetype: 'audio/ogg',
            mediatype: 'audio',
            fileName: 'audio.ogg',
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) {
          console.error('[Chat] reenvio de áudio (evolution) falhou:', result.error || result.message);
          throw new Error('Não foi possível reenviar o áudio.');
        }
      } else {
        const to = selectedConversation.remote_jid
          .replace(/@s\.whatsapp\.net$/, '')
          .replace(/\D/g, '');
        const response = await fetch('/api/chat/whatsapp-official/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            config_id: selectedChannel.id,
            to,
            type: 'audio',
            ...(uploaded.meta_id ? { meta_id: uploaded.meta_id } : {}),
            media_url: uploaded.url || undefined,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) {
          throw new Error(getSendErrorMessage(response.status, result.error || result.message));
        }
      }
      // O reenvio cria uma nova mensagem. Retira da tela somente o balão antigo
      // que falhou; a nova mensagem entra pelo Realtime já com seu status real.
      setMessages((current) => current.filter((item) => item.id !== msg.id));
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Não foi possível reenviar o áudio.');
    } finally {
      setRetryingAudioMessageId(null);
    }
  };

  /**
   * Ícone de entrega (bolhas enviadas).
   * - `from_me` pode vir boolean ou string do JSON/Realtime.
   * - WhatsApp Oficial: qualquer status que não seja falha explícita conta como ≥ enviado (evita relógio em
   *   received/pending/updated/valores crus da Meta). delivered/read/played → ticks.
   */
  const getStatusIcon = (msg: Message) => {
    const fromMe =
      msg.from_me === true ||
      (msg as { from_me?: unknown }).from_me === 'true' ||
      (msg as { from_me?: unknown }).from_me === 1;
    const raw = String(msg.status ?? 'pending')
      .trim()
      .toLowerCase();
    let s = raw || 'pending';

    const isOfficialChannel =
      msg.provider === 'whatsapp_official' ||
      (!!msg.whatsapp_config_id && msg.instance_id == null);

    const isOfficialOutbound = fromMe && isOfficialChannel;

    const failed = new Set(['failed', 'error', 'undelivered', 'rejected']);
    const readLike = new Set(['read', 'played', 'listened']);
    if (isOfficialOutbound && !failed.has(s)) {
      if (readLike.has(s)) s = 'read';
      else if (s === 'delivered') s = 'delivered';
      else s = 'sent';
    } else if (readLike.has(s)) {
      s = 'read';
    }

    switch (s) {
      case 'sent': return <Check className="w-4 h-4" />;
      case 'delivered': return <CheckCheck className="w-4 h-4" />;
      case 'read': return <CheckCheck className="w-4 h-4" style={{ color: '#E86A24' }} />;
      case 'failed':
      case 'error':
      case 'undelivered':
      case 'rejected': return <AlertCircle className="w-4 h-4 text-red-200" />;
      default: return <Clock className="w-4 h-4" />;
    }
  };

  const getInitials = (name: string) =>
    name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

  const isWithin24hWindow = (conv: Conversation): boolean => isWithin24hWindowInbox(conv);

  const getConversationColor = (title: string) => {
    const colors = ['#E86A24', '#D95E1B', '#C9531A', '#EF9057', '#5AA832', '#4C9628', '#3E841E', '#2F7214'];
    return colors[(title.charCodeAt(0) || 0) % colors.length];
  };

  // ── Filtros e ordenação ────────────────────────────────────────────────────
  // isActiveConversation:
  //   - WhatsApp Oficial: dentro da janela 24h E não resolvida
  //   - Evolution: qualquer conversa não resolvida (sem conceito de janela 24h)
  const isActiveConversation = (conv: Conversation): boolean => isActiveInboxConversation(conv);

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

  const sortedConversations = sortConversationsForInbox(filteredConversations) as Conversation[];

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

      {deleteConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={() => setDeleteConfirm(null)}>
          <div className="zap-chat-panel rounded-xl shadow-2xl max-w-sm w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-900/30">
                <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Apagar mensagem</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  A API Oficial do WhatsApp <strong>não suporta</strong> exclusão de mensagens já enviadas.
                  A mensagem será removida apenas do chat da plataforma, mas <strong>continuará visível no WhatsApp do destinatário</strong>.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-[#E86A24]/10 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => executeDeleteMessage(deleteConfirm.messageId)}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors"
              >
                Apagar do chat
              </button>
            </div>
          </div>
        </div>
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

        {evolutionInstanceNotice && (
          <div
            className="flex-shrink-0 flex items-start gap-3 px-4 py-3 bg-amber-500/15 dark:bg-amber-500/20 border-b border-amber-500/40 text-amber-900 dark:text-amber-100"
            role="alert"
          >
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <p className="text-sm font-medium flex-1 min-w-0">{evolutionInstanceNotice}</p>
            <button
              type="button"
              onClick={() => setEvolutionInstanceNotice(null)}
              className="flex-shrink-0 p-1.5 rounded-lg hover:bg-amber-500/20 transition-colors"
              aria-label="Fechar aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 3 Painéis — coluna crm-atendimento oculta por padrão; botão abre/fecha */}
        <div className="chat-shell flex flex-1 min-h-0 overflow-hidden">
          {!(isMobile && selectedConversationId) && (
          <>
          {/* ── Painel Esquerdo (crm-atendimento) — visível só quando chatSidebarOpen ── */}
          {chatSidebarOpen && (
          <div className="w-48 md:w-64 min-h-0 flex-shrink-0 overflow-hidden zap-chat-panel border-r border-[#E86A24]/10 flex flex-col relative">
            <button
              type="button"
              onClick={() => setChatSidebarOpen(false)}
              className="absolute top-3 right-3 z-10 rounded-lg p-1.5 text-gray-400 hover:bg-[#E86A24]/10 hover:text-[#E86A24]"
              aria-label="Fechar menu"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="p-4 border-b border-[#E86A24]/10">
              <h2 className="mb-3 pr-8 text-lg font-bold text-white">crmTR</h2>
              <div className="space-y-1">
                <button
                  onClick={() => setActiveView('chat')}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all ${
                    activeView === 'chat'
                      ? 'bg-[#E86A24] text-white shadow-md shadow-[#E86A24]/25'
                      : 'text-gray-300 hover:bg-[#E86A24]/10'
                  }`}
                >
                  <MessageCircle className="w-5 h-5" />
                  Todas as conversas
                </button>
                <button
                  onClick={() => setActiveView('contacts')}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all ${
                    activeView === 'contacts'
                      ? 'bg-[#E86A24] text-white shadow-md shadow-[#E86A24]/25'
                      : 'text-gray-300 hover:bg-[#E86A24]/10'
                  }`}
                >
                  <BookUser className="w-5 h-5" />
                  Contatos
                </button>

                {/* Agente IA — apenas Evolution */}
                {selectedChannel?.type === 'evolution' && (
                  <button
                    onClick={() => setActiveView('agente-ia')}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all ${
                      activeView === 'agente-ia'
                        ? 'bg-[#E86A24] text-white shadow-md shadow-[#E86A24]/25'
                        : 'text-gray-300 hover:bg-[#E86A24]/10'
                    }`}
                  >
                    <Workflow className="w-5 h-5" />
                    Agente IA
                  </button>
                )}

                {/* Disparo em Massa — apenas Evolution */}
                {selectedChannel?.type === 'evolution' && (
                  <button
                    onClick={() => setActiveView('broadcast')}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all ${
                      activeView === 'broadcast'
                        ? 'bg-[#E86A24] text-white shadow-md shadow-[#E86A24]/25'
                        : 'text-gray-300 hover:bg-[#E86A24]/10'
                    }`}
                  >
                    <Radio className="w-5 h-5" />
                    Disparo em Massa
                    {broadcastRunning && (
                      <span className="ml-auto w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Seletor de Canal */}
            {canSelectChannel ? (
              <div className="p-4 border-b border-[#E86A24]/10">
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500">
                  Canal
                </label>
                <select
                  value={selectedChannel ? `${selectedChannel.type}:${selectedChannel.id}` : ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEvolutionInstanceNotice(null);
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
                  className={`w-full px-3 py-2 text-sm ${zapInput} border-[#E86A24]/50`}
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
              <div className="p-4 border-b border-[#E86A24]/10">
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
          {!(conversationsListHidden && selectedConversationId) && (activeView === 'agente-ia' ? (
            /* ── Vista Agente IA ── */
            <div className="min-w-0 flex-1 md:w-80 md:flex-shrink-0 overflow-hidden zap-chat-panel border-r border-[#E86A24]/10 flex flex-col">
              <div className="flex-shrink-0 p-4 border-b border-[#E86A24]/10 flex items-center gap-2">
                <Workflow className="w-5 h-5 text-[#E86A24]" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Agente IA</h3>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {selectedChannel?.type !== 'evolution' ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Disponível apenas para canais Evolution.</p>
                ) : (
                  <>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Instância atual</p>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{selectedChannel.instance_name}</p>
                    </div>

                    {instanceFlow && (
                      <div className="p-3 rounded-lg border border-[#E86A24]/50 bg-[#E86A24]/10">
                        <div className="flex items-center gap-2 mb-1">
                          <Bot className="w-4 h-4 text-[#E86A24]" />
                          <span className="text-xs font-semibold text-[#5a9e2f] dark:text-[#E86A24]">Flow ativo</span>
                        </div>
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{instanceFlow.flows?.name}</p>
                        {instanceFlow.flows?.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{instanceFlow.flows.description}</p>
                        )}
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
                        Selecionar Flow
                      </label>
                      {loadingFlows ? (
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Carregando flows...
                        </div>
                      ) : (
                        <select
                          value={selectedFlowId}
                          onChange={(e) => setSelectedFlowId(e.target.value)}
                          className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 border-gray-300 dark:border-[#404040]"
                        >
                          <option value="">— Sem flow (desativar) —</option>
                          {availableFlows.map((f) => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                          ))}
                        </select>
                      )}
                      {availableFlows.length === 0 && !loadingFlows && (
                        <p className="text-xs text-gray-400 mt-1">Nenhum flow ativo encontrado.</p>
                      )}
                    </div>

                    <button
                      onClick={saveFlowConfig}
                      disabled={savingFlowConfig}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-60"
                      style={{ backgroundColor: '#E86A24' }}
                    >
                      {savingFlowConfig ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                      {savingFlowConfig ? 'Salvando...' : 'Salvar configuração'}
                    </button>

                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      O flow selecionado será executado automaticamente quando mensagens chegarem nesta instância.
                    </p>
                  </>
                )}
              </div>
            </div>
          ) : activeView === 'broadcast' ? (
            /* ── Vista Disparo em Massa ── */
            <div className="min-w-0 flex-1 md:w-96 md:flex-shrink-0 overflow-hidden zap-chat-panel border-r border-[#E86A24]/10 flex flex-col">
              <div className="flex-shrink-0 p-4 border-b border-[#E86A24]/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Radio className="w-5 h-5 text-[#E86A24]" />
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Disparo em Massa</h3>
                  {broadcastRunning && <span className="text-xs text-green-500 font-medium animate-pulse">• Executando</span>}
                </div>
                {broadcastJob && !broadcastRunning && broadcastJob.status !== 'completed' && broadcastJob.status !== 'cancelled' && (
                  <button
                    onClick={resumeBroadcast}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg text-white"
                    style={{ backgroundColor: '#E86A24' }}
                  >
                    <Play className="w-3 h-3" /> Retomar
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {selectedChannel?.type !== 'evolution' ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Disponível apenas para canais Evolution.</p>
                ) : broadcastJob ? (
                  /* ── Progresso do disparo ── */
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{broadcastJob.title}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          broadcastJob.status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : broadcastJob.status === 'running' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          : broadcastJob.status === 'paused' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                          : broadcastJob.status === 'cancelled' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                        }`}>
                          {broadcastJob.status === 'completed' ? 'Concluído'
                           : broadcastJob.status === 'running' ? 'Enviando...'
                           : broadcastJob.status === 'paused' ? 'Pausado'
                           : broadcastJob.status === 'cancelled' ? 'Cancelado'
                           : 'Aguardando'}
                        </span>
                      </div>

                      {/* Barra de progresso */}
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-1">
                        <div
                          className="h-2 rounded-full transition-all duration-500"
                          style={{
                            width: `${broadcastJob.total_count > 0 ? Math.round(((broadcastProgress?.current ?? broadcastJob.current_index) / broadcastJob.total_count) * 100) : 0}%`,
                            backgroundColor: '#E86A24',
                          }}
                        />
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 text-right">
                        {broadcastProgress?.current ?? broadcastJob.current_index} / {broadcastJob.total_count} enviados
                      </p>
                    </div>

                    {/* Botões de controle */}
                    <div className="flex gap-2">
                      {broadcastRunning ? (
                        <button
                          onClick={pauseBroadcast}
                          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium"
                        >
                          <Pause className="w-4 h-4" /> Pausar
                        </button>
                      ) : broadcastJob.status !== 'completed' && broadcastJob.status !== 'cancelled' ? (
                        <button
                          onClick={resumeBroadcast}
                          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-white text-sm font-medium"
                          style={{ backgroundColor: '#E86A24' }}
                        >
                          <Play className="w-4 h-4" /> Retomar
                        </button>
                      ) : null}
                      {broadcastJob.status !== 'completed' && (
                        <button
                          onClick={cancelBroadcast}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500 text-white text-sm font-medium"
                        >
                          <StopCircle className="w-4 h-4" /> Cancelar
                        </button>
                      )}
                      {(broadcastJob.status === 'completed' || broadcastJob.status === 'cancelled') && (
                        <button
                          onClick={() => { setBroadcastJob(null); setBroadcastLog([]); setBroadcastProgress(null); setBroadcastContacts([]); setSelectedCrmMessage(null); setBroadcastTitle(''); }}
                          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium"
                        >
                          <RotateCcw className="w-4 h-4" /> Novo disparo
                        </button>
                      )}
                    </div>

                    {/* Log em tempo real */}
                    <div>
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Log de envio</p>
                      <div ref={broadcastLogRef} className="h-48 overflow-y-auto rounded-lg border border-[#E86A24]/12 bg-[#160f0a]/60 p-2 space-y-1 text-xs font-mono">
                        {broadcastLog.length === 0 && (
                          <p className="text-gray-400 text-center py-4">Nenhum envio ainda...</p>
                        )}
                        {broadcastLog.map((entry, i) => (
                          <div key={i} className={`flex items-start gap-2 ${entry.success ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                            <span>{entry.success ? '✓' : '✗'}</span>
                            <span className="truncate">{entry.name ? `${entry.name} (${entry.phone})` : entry.phone}</span>
                            {entry.error && <span className="text-gray-400 truncate">— {entry.error}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ── Formulário de criação de disparo ── */
                  <div className="space-y-4">
                    {/* Título */}
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Título (opcional)</label>
                      <input
                        type="text"
                        value={broadcastTitle}
                        onChange={(e) => setBroadcastTitle(e.target.value)}
                        placeholder="Ex: Promoção Black Friday"
                        className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 border-gray-300 dark:border-[#404040]"
                      />
                    </div>

                    {/* Mensagem do CRM */}
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Mensagem</label>
                      {loadingCrmMessages ? (
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                          <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
                        </div>
                      ) : (
                        <select
                          value={selectedCrmMessage?.id ?? ''}
                          onChange={(e) => {
                            const msg = crmMessages.find((m) => m.id === e.target.value) ?? null;
                            setSelectedCrmMessage(msg);
                          }}
                          className="w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 border-gray-300 dark:border-[#404040]"
                        >
                          <option value="">— Selecione uma mensagem —</option>
                          {crmMessages.map((m) => (
                            <option key={m.id} value={m.id}>
                              [{m.message_type?.toUpperCase() ?? 'TEXTO'}] {m.title}
                            </option>
                          ))}
                        </select>
                      )}
                      {selectedCrmMessage && (
                        <div className="mt-2 p-2 rounded-lg bg-gray-50 dark:bg-[#333] border border-[#E86A24]/12">
                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 font-semibold">{selectedCrmMessage.title}</p>
                          {selectedCrmMessage.attachment_url && (
                            <div className="flex items-center gap-1 text-xs text-blue-500 mb-1">
                              <Paperclip className="w-3 h-3" />
                              <span>Mídia anexada</span>
                            </div>
                          )}
                          <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-3">
                            {selectedCrmMessage.preview || selectedCrmMessage.content}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Import de contatos via CSV */}
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                        Contatos (.csv)
                      </label>
                      <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-[#404040] cursor-pointer hover:border-[#E86A24] transition-colors">
                        <Upload className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-500 dark:text-gray-400 truncate">
                          {broadcastCsvFileName || 'Selecionar arquivo CSV'}
                        </span>
                        <input
                          type="file"
                          accept=".csv"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setBroadcastCsvFileName(file.name);
                            const reader = new FileReader();
                            reader.onload = (evt) => {
                              const text = evt.target?.result?.toString() || '';
                              const parsed = parseBroadcastCsv(text);
                              setBroadcastContacts(parsed);
                            };
                            reader.readAsText(file);
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {broadcastContacts.length > 0 && (
                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                          ✓ {broadcastContacts.length} contato(s) carregado(s)
                        </p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        CSV com colunas: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">telefone</code> e <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">nome</code> (opcional)
                      </p>
                    </div>

                    {/* Delay entre disparos */}
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                        Intervalo entre disparos
                      </label>
                      <div className="flex items-center gap-2">
                        <select
                          value={broadcastDelay}
                          onChange={(e) => setBroadcastDelay(Number(e.target.value))}
                          className="flex-1 px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 border-gray-300 dark:border-[#404040]"
                        >
                          <option value={15}>15 segundos</option>
                          <option value={30}>30 segundos</option>
                          <option value={45}>45 segundos</option>
                          <option value={60}>1 minuto</option>
                          <option value={90}>1 min 30 seg</option>
                          <option value={120}>2 minutos</option>
                          <option value={180}>3 minutos</option>
                          <option value={300}>5 minutos</option>
                        </select>
                      </div>
                    </div>

                    {/* Botão iniciar */}
                    <button
                      onClick={startBroadcast}
                      disabled={broadcastCreating || !selectedCrmMessage || broadcastContacts.length === 0}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ backgroundColor: '#E86A24' }}
                    >
                      {broadcastCreating
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Iniciando...</>
                        : <><Send className="w-4 h-4" /> Iniciar disparo ({broadcastContacts.length} contatos)</>
                      }
                    </button>

                    {/* Histórico de disparos */}
                    {broadcastJobs.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Disparos anteriores</p>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {broadcastJobs.map((job) => (
                            <div
                              key={job.id}
                              className="p-2.5 rounded-lg border border-[#E86A24]/12 cursor-pointer hover:border-[#E86A24] transition-colors"
                              onClick={() => {
                                setBroadcastJob(job);
                                setBroadcastProgress({ current: job.current_index, total: job.total_count });
                                setBroadcastLog([]);
                              }}
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">{job.title}</span>
                                <span className={`text-xs ml-2 flex-shrink-0 ${
                                  job.status === 'completed' ? 'text-green-500'
                                  : job.status === 'running' ? 'text-blue-500'
                                  : job.status === 'paused' ? 'text-amber-500'
                                  : job.status === 'cancelled' ? 'text-red-500'
                                  : 'text-gray-400'
                                }`}>
                                  {job.status === 'completed' ? '✓ Concluído'
                                   : job.status === 'running' ? '⟳ Em execução'
                                   : job.status === 'paused' ? '⏸ Pausado'
                                   : job.status === 'cancelled' ? '✗ Cancelado'
                                   : '○ Pendente'}
                                </span>
                              </div>
                              <p className="text-xs text-gray-400 mt-0.5">
                                {job.current_index}/{job.total_count} • {job.instance_name}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : activeView === 'contacts' ? (
            /* Vista Contatos */
            <div className="min-w-0 flex-1 md:w-80 md:flex-shrink-0 overflow-hidden zap-chat-panel border-r border-[#E86A24]/10 flex flex-col">
              <div className="flex-shrink-0 p-3 border-b border-[#E86A24]/10 flex items-center gap-2">
                {!chatSidebarOpen && (
                  <button
                    type="button"
                    onClick={() => setChatSidebarOpen(true)}
                    className="p-2 rounded-lg hover:bg-[#E86A24]/10 text-gray-600 dark:text-gray-300 flex-shrink-0"
                    aria-label="Abrir menu crm-atendimento"
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
                          className="p-3 border-b border-gray-100 dark:border-[#404040] cursor-pointer hover:bg-[#E86A24]/10 transition-colors"
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
            <div className="min-w-0 flex-1 md:w-80 md:flex-shrink-0 overflow-hidden zap-chat-panel border-r border-[#E86A24]/10 flex flex-col">
              {/* Botão menu + Busca + Abas */}
              <div className="flex-shrink-0 p-3 border-b border-[#E86A24]/10">
                {!chatSidebarOpen && (
                  <div className="mb-2">
                    <button
                      type="button"
                      onClick={() => setChatSidebarOpen(true)}
                      className="p-2 rounded-lg hover:bg-[#E86A24]/10 text-gray-600 dark:text-gray-300 inline-flex items-center gap-2 text-sm font-medium"
                      aria-label="Abrir menu crm-atendimento"
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
                    className={`w-full py-2 pl-10 pr-4 text-sm text-white placeholder:text-gray-500 ${zapInput}`}
                  />
                </div>
                {tagOptions.length > 0 && (
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Filtrar por etiqueta</label>
                    <select
                      value={tagFilter}
                      onChange={(e) => setTagFilter(e.target.value)}
                      className={`w-full px-3 py-2 text-sm text-white ${zapInput}`}
                    >
                      <option value="">Todas</option>
                      {tagOptions.map((t) => (
                        <option key={t.id} value={t.name}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex items-center gap-1 border-b border-[#E86A24]/10 -mx-4 px-4">
                  {/* Todos = janela 24h ativa (prioridade máxima) */}
                  <button
                    onClick={() => setConversationFilter('all')}
                    className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                      conversationFilter === 'all'
                        ? 'border-[#E86A24] text-[#E86A24]'
                        : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                    }`}
                  >
                    Todos ({allCount})
                  </button>
                  <button
                    onClick={() => setConversationFilter('mine')}
                    className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                      conversationFilter === 'mine'
                        ? 'border-[#E86A24] text-[#E86A24]'
                        : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                    }`}
                  >
                    Minhas ({mineCount})
                  </button>
                  <button
                    onClick={() => setConversationFilter('unassigned')}
                    className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                      conversationFilter === 'unassigned'
                        ? 'border-[#E86A24] text-[#E86A24]'
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
                className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain p-2"
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
                  <div className="p-6 text-center text-sm text-gray-500">
                    {selectedChannel ? (
                      <>
                        {conversationFilter === 'all'
                          ? 'Nenhuma conversa com janela 24h ativa (pendente).'
                          : conversationFilter === 'unassigned'
                            ? 'Nenhuma conversa no histórico (template ou resolvidas).'
                            : 'Nenhuma conversa encontrada.'}
                        {(userStatus === 'super_admin' || userStatus === 'admin') && (
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
                          className={`mx-2 mb-2 cursor-pointer rounded-xl border p-3 transition-all ${
                            isSelected
                              ? 'zap-card-client border-[#E86A24]/50 bg-[#E86A24]/10 shadow-[0_4px_12px_rgba(232,106,36,0.15)]'
                              : 'border-transparent hover:zap-card-client hover:border-[#404040]'
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
                                <h3 className="flex flex-wrap items-center gap-1.5 truncate text-sm font-semibold text-white">
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
                                    style={{ backgroundColor: '#E86A24' }}
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
          <div className="chat-messages-pane flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {selectedConversationId && selectedConversation ? (
              <>
                {/* Header da conversa — compacto; etiquetas e ações na mesma linha */}
                <div className="flex-shrink-0 zap-chat-panel border-b border-[#E86A24]/10">
                  <div className="px-3 py-2 flex items-center gap-2 min-w-0 flex-wrap">
                    {isMobile && (
                      <button
                        type="button"
                        onClick={() => setSelectedConversationId('')}
                        className="p-1.5 rounded-lg hover:bg-[#E86A24]/10 text-gray-700 dark:text-gray-200 flex-shrink-0"
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
                        className="p-1.5 rounded-lg hover:bg-[#E86A24]/10 text-gray-600 dark:text-gray-400 flex-shrink-0"
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
                    {(userStatus === 'admin' || userStatus === 'super_admin') && (
                      <div ref={tagsPopoverRef} className="relative">
                        <button
                          type="button"
                          onClick={() => setShowTagsPopover((v) => !v)}
                          className="px-2 py-1 text-xs font-medium rounded-md border border-gray-300 dark:border-[#404040] text-gray-600 dark:text-gray-300 hover:bg-[#E86A24]/10 flex items-center gap-1"
                        >
                          Etiquetas
                          {(selectedConversation.tags || []).length > 0 && (
                            <span className="bg-[#E86A24] text-white rounded-full min-w-[14px] h-3.5 flex items-center justify-center text-[10px] px-1">
                              {(selectedConversation.tags || []).length}
                            </span>
                          )}
                        </button>
                        {showTagsPopover && (
                          <div className="absolute right-0 top-full mt-1 z-20 w-56 py-2 zap-chat-panel border border-[#E86A24]/12 rounded-lg shadow-lg">
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
                                      className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-[#E86A24]/10 text-gray-700 dark:text-gray-200"
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
                    ) : (userStatus === 'admin' || userStatus === 'super_admin') ? (
                      <button
                        onClick={handleResolveConversation}
                        disabled={resolvingConversation}
                        className="px-2.5 py-1 text-xs font-medium text-white rounded-md flex items-center gap-1.5 disabled:opacity-60"
                        style={{ backgroundColor: '#E86A24' }}
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
                        className="p-1.5 hover:bg-[#E86A24]/10 rounded-md text-gray-500 dark:text-gray-400"
                        aria-label="Mais opções"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {showConvMenu && (
                        <div className="absolute right-0 top-full mt-1 z-30 w-52 py-1 zap-chat-panel border border-[#E86A24]/12 rounded-lg shadow-lg">
                          {selectedConversation.attendance_status === 'resolvido' &&
                            (userStatus === 'admin' || userStatus === 'super_admin') && (
                            <button
                              type="button"
                              onClick={handleReopenConversation}
                              disabled={reopeningConversation}
                              className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-[#E86A24]/10 text-gray-700 dark:text-gray-200 disabled:opacity-60"
                            >
                              {reopeningConversation ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                              Reabrir conversa
                            </button>
                          )}
                          {(userStatus === 'admin' || userStatus === 'super_admin') && (
                            <button
                              type="button"
                              onClick={() => { setShowTagsPopover(true); setShowConvMenu(false); }}
                              className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-[#E86A24]/10 text-gray-700 dark:text-gray-200"
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
                        className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors px-3 py-1.5 rounded-full bg-white dark:bg-[#333] border border-[#E86A24]/12 shadow-sm"
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
                      const canDelete = userStatus === 'admin' || userStatus === 'super_admin';

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
                                    ? 'bg-[#E86A24] text-white rounded-br-none'
                                    : 'rounded-bl-none border border-[#E86A24]/15 bg-[#1f1612] text-gray-100'
                                } ${isDeleting ? 'opacity-50' : ''}`}
                              >
                                <MessageContent
                                  msg={msg}
                                  fromMe={msg.from_me}
                                  userId={userId}
                                  onMediaClick={(url, type, caption) => setMediaModal({ url, type, caption })}
                                  onMediaResolved={(msgId, url) => setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, media_url: url } : m))}
                                />
                                <div
                                  className={`flex items-center justify-end gap-1 mt-1 ${
                                    msg.from_me ? 'text-white/80' : 'text-gray-500 dark:text-gray-400'
                                  }`}
                                >
                                  <span className="text-xs">{formatMessageTime(msg.timestamp)}</span>
                                  {msg.from_me && getStatusIcon(msg)}
                                </div>
                              </div>
                              {msg.from_me && msg.media_type === 'audio' && isFailedMessage(msg) && (
                                <button
                                  type="button"
                                  onClick={() => void retryFailedAudioMessage(msg)}
                                  disabled={retryingAudioMessageId !== null || uploading}
                                  className="mb-1 inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-red-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-red-600 shadow-sm transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-500/50 dark:bg-[#333] dark:text-red-300 dark:hover:bg-red-950/30"
                                  title="Tentar reenviar este áudio"
                                  aria-label="Tentar reenviar este áudio"
                                >
                                  {retryingAudioMessageId === msg.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  )}
                                  <span className="hidden sm:inline">Reenviar</span>
                                </button>
                              )}
                              {/* Botão apagar — aparece no hover */}
                              {canDelete && (isHovered || isDeleting) && (
                                <button
                                  type="button"
                                  onClick={() => requestDeleteMessage(msg.id)}
                                  disabled={isDeleting || !!deletingMessageId}
                                  className="flex-shrink-0 mb-1 p-1 rounded-full bg-white dark:bg-[#333] border border-[#E86A24]/12 text-gray-400 hover:text-red-500 hover:border-red-300 shadow-sm disabled:opacity-50 transition-colors"
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
                    <div className="flex-1 min-w-0 space-y-2">
                      <p className="text-sm">{sendError}</p>
                      {recordedBlob && !isRecording && (
                        <button
                          type="button"
                          onClick={() => void handleSendMessage()}
                          disabled={
                            sending ||
                            uploading ||
                            (selectedChannel?.type === 'whatsapp_official' && !canSendFreeMessage)
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {sending || uploading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                          Tentar reenviar áudio
                        </button>
                      )}
                    </div>
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
                <div className="flex-shrink-0 w-full zap-chat-panel border-t border-[#E86A24]/10 px-3 py-3">
                  <input ref={fileInputRef} type="file" className="hidden" accept="image/jpeg,image/png,image/webp,audio/ogg,audio/mpeg,video/mp4,application/pdf,text/plain,.doc,.docx,.xls,.xlsx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleFileSelect} />
                  <input ref={imageInputRef} type="file" className="hidden" accept="image/jpeg,image/png,image/webp" onChange={handleFileSelect} />
                  <input ref={docInputRef} type="file" className="hidden" accept="application/pdf,text/plain,.doc,.docx,.xls,.xlsx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleFileSelect} />
                  {videoUploadProgress != null && (
                    <div className="mb-2 rounded-lg border border-[#E86A24]/30 bg-[#E86A24]/10 p-3">
                      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                        <span className="font-medium text-[#E86A24]">{videoUploadStage}</span>
                        <span className="tabular-nums text-[#E86A24]/80">{videoUploadProgress}%</span>
                      </div>
                      <div
                        className="h-2 overflow-hidden rounded-full bg-[#E86A24]/20"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={videoUploadProgress}
                      >
                        <div
                          className="h-full rounded-full bg-[#E86A24] transition-[width] duration-500 ease-out"
                          style={{ width: `${videoUploadProgress}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-[11px] text-[#E86A24]/70">
                        Vídeos grandes podem levar alguns minutos. Não feche esta conversa.
                      </p>
                    </div>
                  )}
                  {/* ── Prévia de áudio gravado ──────────────────────────── */}
                  {recordedBlob && !isRecording && (
                    <div className="mb-2 flex flex-col gap-2 rounded-xl border border-[#E86A24]/35 bg-[#160f0a]/50 p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-[#E86A24]/20 flex items-center justify-center">
                            <Mic size={13} className="text-[#E86A24]" />
                          </div>
                          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Prévia do áudio</span>
                        </div>
                        <button
                          type="button"
                          onClick={discardRecordedAudio}
                          disabled={uploading || sending}
                          className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
                          aria-label="Descartar gravação"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                      <audio src={recordedBlobUrl!} controls className="w-full max-w-full" style={{ height: '36px' }} />
                    </div>
                  )}
                  {attachedMedia && (
                    <div className="mb-2 max-w-full p-2 bg-gray-100 dark:bg-[#333] rounded-lg flex items-center gap-2 border border-[#E86A24]/12">
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
                        className={`p-2 sm:p-1.5 rounded-lg hover:bg-[#E86A24]/10 transition-colors ${showEmojiPicker ? 'text-[#E86A24]' : 'text-gray-500 dark:text-gray-400'}`}
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
                      className="p-2 sm:p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-[#E86A24]/10 disabled:opacity-50"
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
                        className="p-2 sm:p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-[#E86A24]/10 disabled:opacity-50"
                        title="Gravar áudio"
                      >
                        <Mic className="w-4 h-4" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => docInputRef.current?.click()}
                      disabled={uploading || selectedChannel?.type !== 'whatsapp_official' || !canSendFreeMessage}
                      className="p-2 sm:p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-[#E86A24]/10 disabled:opacity-50"
                      title="Documento (PDF)"
                    >
                      <FileText className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={uploading || selectedChannel?.type !== 'whatsapp_official' || !canSendFreeMessage}
                      className="p-2 sm:p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-[#E86A24]/10 disabled:opacity-50"
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
                        className={`w-full resize-none overflow-y-auto rounded-xl border border-[#785037]/40 bg-[#1a120d] px-3 py-2.5 text-sm text-gray-100 placeholder:text-gray-500 focus:border-[#E86A24] focus:outline-none focus:ring-2 focus:ring-[#E86A24]/30`}
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
                        style={{ backgroundColor: '#E86A24' }}
                      >
                        {spellChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={handleSendMessage}
                        disabled={
                          (!messageText.trim() && !attachedMedia && !recordedBlob) ||
                          sending ||
                          uploading ||
                          !canSendFreeMessage
                        }
                        title={
                          !canSendFreeMessage
                            ? 'Fora da janela 24h'
                            : recordedBlob
                              ? 'Enviar nota de voz'
                              : 'Enviar'
                        }
                        className="px-3 py-2 text-white rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-50 min-w-[44px] h-[38px]"
                        style={{ backgroundColor: '#E86A24' }}
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
              <div className="flex flex-1 items-center justify-center p-8">
                <div className="zap-card-client max-w-sm rounded-2xl border border-[#E86A24]/20 p-8 text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#E86A24]/15">
                    <MessageSquare className="h-8 w-8 text-[#E86A24]" />
                  </div>
                  <p className="text-sm font-medium text-gray-300">Selecione uma conversa para começar</p>
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
          <div className="zap-chat-panel rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {convContact ? 'Editar Contato' : 'Salvar Contato'}
              </h3>
              <button
                type="button"
                onClick={() => setShowContactModal(false)}
                className="p-2 rounded-lg hover:bg-[#E86A24]/10 text-gray-500"
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
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] focus:outline-none"
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
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Horário de Atendimento
                </label>
                <select
                  value={contactForm.horario}
                  onChange={(e) => setContactForm((f) => ({ ...f, horario: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-[#404040] rounded-lg bg-white dark:bg-[#333] text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] focus:outline-none"
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
                className="flex-1 px-4 py-2.5 text-sm font-medium border border-gray-300 dark:border-[#404040] rounded-lg text-gray-700 dark:text-gray-200 hover:bg-[#E86A24]/10 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveContact}
                disabled={savingContact}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white rounded-lg flex items-center justify-center gap-2 disabled:opacity-60 transition-colors"
                style={{ backgroundColor: '#E86A24' }}
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
