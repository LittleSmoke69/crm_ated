'use client';

import React, { useState } from 'react';
import { X, Users, ExternalLink, MessageSquare, Copy, Check } from 'lucide-react';

const GRUPO_LINK = 'https://chat.whatsapp.com/FA5LGWfemuPEeUvrijDoRJ';

export interface GroupMessagingInstance {
  id: string;
  instance_name: string | null;
  phone_number: string | null;
  status: string | null;
  sends_group_messages: boolean;
  group_msg_next_at: string | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  instances?: GroupMessagingInstance[];
  onToggleInstance?: (id: string, enable: boolean) => Promise<void>;
  onToggleAll?: (enable: boolean) => Promise<void>;
  loading?: boolean;
}

export default function GrupoMaturacaoModal({ isOpen, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  function handleCopy() {
    navigator.clipboard.writeText(GRUPO_LINK).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-2xl w-full max-w-sm border border-slate-200 dark:border-[#404040] flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 dark:border-[#404040] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-xl">
              <Users className="w-5 h-5 text-green-600 dark:text-[#00ff00]" />
            </div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-white">
              Grupo de Maturação
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-[#333] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3">
            <MessageSquare className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
            <p className="text-sm text-slate-600 dark:text-[#bbb]">
              Entre no grupo de maturação do WhatsApp para manter suas instâncias ativas e aquecidas na rede.
            </p>
          </div>

          {/* Botão Entrar */}
          <a
            href={GRUPO_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white rounded-xl font-medium text-sm transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            Entrar no Grupo
          </a>

          {/* Botão Copiar link */}
          <button
            onClick={handleCopy}
            className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-xl border border-slate-200 dark:border-[#555] text-slate-600 dark:text-[#aaa] hover:bg-slate-50 dark:hover:bg-[#333] font-medium text-sm transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-green-500" />
                <span className="text-green-600 dark:text-green-400">Link copiado!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Copiar link do grupo
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
