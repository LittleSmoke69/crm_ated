'use client';

import React from 'react';
import { X, Send, Calendar, Megaphone } from 'lucide-react';

interface SendMessageChoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSendNow: () => void;
  onSchedule: () => void;
  onMassCampaign?: () => void;
  messageTitle: string;
}

const SendMessageChoiceModal: React.FC<SendMessageChoiceModalProps> = ({
  isOpen,
  onClose,
  onSendNow,
  onSchedule,
  onMassCampaign,
  messageTitle,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-[100] p-0 sm:p-4 overflow-y-auto">
      <div className="bg-gray-100 dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-t-2xl sm:rounded-2xl w-full max-w-md shadow-2xl overflow-hidden mx-auto max-h-[90vh] sm:max-h-none">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between">
          <div>
            <h2 className="text-gray-800 dark:text-white font-bold text-lg">Enviar mensagem</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{messageTitle}</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-gray-200 dark:hover:bg-[#404040] rounded-full text-gray-600 dark:text-gray-400 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Options */}
        <div className="p-4 sm:p-6 space-y-4">
          <button
            onClick={onSendNow}
            className="w-full p-4 py-3.5 sm:py-4 bg-[#8CD955] hover:bg-[#7BC84A] active:scale-[0.99] text-white font-bold rounded-xl transition-all shadow-lg shadow-[#8CD955]/20 flex items-center justify-center gap-3"
          >
            <Send className="w-5 h-5" />
            Enviar agora
          </button>

          {onMassCampaign && (
            <button
              onClick={onMassCampaign}
              className="w-full p-4 py-3.5 sm:py-4 bg-white dark:bg-[#333] hover:bg-gray-50 dark:hover:bg-[#404040] active:scale-[0.99] border-2 border-blue-500 text-blue-600 dark:text-blue-400 font-bold rounded-xl transition-all flex items-center justify-center gap-3"
            >
              <Megaphone className="w-5 h-5" />
              Criar campanha de disparo em massa
            </button>
          )}

          <button
            onClick={onSchedule}
            className="w-full p-4 py-3.5 sm:py-4 bg-white dark:bg-[#333] hover:bg-gray-50 dark:hover:bg-[#404040] active:scale-[0.99] border-2 border-[#8CD955] text-[#8CD955] font-bold rounded-xl transition-all flex items-center justify-center gap-3"
          >
            <Calendar className="w-5 h-5" />
            Agendar disparo
          </button>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-[#404040] bg-white dark:bg-[#333]">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-gray-200 dark:bg-[#404040] hover:bg-gray-300 dark:hover:bg-[#505050] text-gray-800 dark:text-white font-medium rounded-lg transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};

export default SendMessageChoiceModal;

