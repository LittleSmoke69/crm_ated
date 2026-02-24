'use client';

import React from 'react';
import { X, Send, Calendar } from 'lucide-react';

interface SendMessageChoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSendNow: () => void;
  onSchedule: () => void;
  messageTitle: string;
}

const SendMessageChoiceModal: React.FC<SendMessageChoiceModalProps> = ({
  isOpen,
  onClose,
  onSendNow,
  onSchedule,
  messageTitle,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-gray-100 dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
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
        <div className="p-6 space-y-4">
          <button
            onClick={onSendNow}
            className="w-full p-4 bg-[#8CD955] hover:bg-[#7BC84A] text-white font-bold rounded-xl transition-all shadow-lg shadow-[#8CD955]/20 flex items-center justify-center gap-3"
          >
            <Send className="w-5 h-5" />
            Enviar agora
          </button>

          <button
            onClick={onSchedule}
            className="w-full p-4 bg-white dark:bg-[#333] hover:bg-gray-50 dark:hover:bg-[#404040] border-2 border-[#8CD955] text-[#8CD955] font-bold rounded-xl transition-all flex items-center justify-center gap-3"
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

