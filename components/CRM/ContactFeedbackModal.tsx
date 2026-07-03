'use client';

import React, { useState } from 'react';
import { X, MessageSquare, Loader2 } from 'lucide-react';

interface ContactFeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  leadId: string | number;
  leadName: string;
  userId: string;
  /** Id numérico do lead na API externa (ex.: 28660). Se informado, é usado como user_id na requisição de feedback. */
  leadOriginalId?: number | string;
  /** URL da banca (filtro selecionado). Usado como fallback se não houver banca do lead. */
  bancaUrl?: string;
  /** ID da banca do lead (modal de detalhes). A API resolve em crm_bancas para obter a URL. */
  bancaId?: string;
  /** Nome da banca do lead (modal de detalhes). A API resolve em crm_bancas para obter a URL. */
  bancaName?: string;
  targetUserId?: string;
  initialFeedback?: string;
  feedbackId?: string;
  onFeedbackSaved?: () => void;
}

const ContactFeedbackModal: React.FC<ContactFeedbackModalProps> = ({
  isOpen,
  onClose,
  leadId,
  leadName,
  userId,
  leadOriginalId,
  bancaUrl,
  bancaId,
  bancaName,
  targetUserId,
  initialFeedback = '',
  feedbackId,
  onFeedbackSaved,
}) => {
  const [feedback, setFeedback] = useState(initialFeedback);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sincroniza feedback inicial quando o modal abre para edição
  React.useEffect(() => {
    if (isOpen) {
      setFeedback(initialFeedback);
    }
  }, [isOpen, initialFeedback]);

  const handleSave = async () => {
    if (!feedback.trim()) {
      setError('Por favor, escreva um feedback sobre o contato');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const method = feedbackId ? 'PUT' : 'POST';
      const body: any = {
        feedback: feedback.trim(),
      };

      if (feedbackId) {
        body.id = feedbackId;
      } else {
        const numericId = leadOriginalId != null
          ? (typeof leadOriginalId === 'number' ? leadOriginalId : parseInt(String(leadOriginalId), 10))
          : (typeof leadId === 'string' && leadId.includes('-') ? parseInt(leadId.split('-').pop() ?? '', 10) : parseInt(String(leadId), 10));
        body.user_id = !Number.isNaN(numericId) ? numericId : parseInt(String(leadId), 10);
        body.banca_url = bancaUrl || null;
        if (bancaId) body.banca_id = bancaId;
        if (bancaName?.trim()) body.banca_name = bancaName.trim();
        body.target_user_id = targetUserId || null;
      }

      const response = await fetch('/api/crm/leads/feedback', {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (result.success) {
        setFeedback('');
        onFeedbackSaved?.();
        onClose();
      } else {
        setError(result.error || 'Erro ao salvar feedback');
      }
    } catch (err) {
      console.error('[ContactFeedbackModal] Erro ao salvar feedback:', err);
      setError('Erro ao salvar feedback. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (!saving) {
      setFeedback('');
      setError(null);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) {
          handleClose();
        }
      }}
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md z-10 animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#E86A24]/10 rounded-lg">
              <MessageSquare className="w-5 h-5 text-[#E86A24]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-800">Feedback do Contato</h2>
              <p className="text-sm text-gray-500 mt-0.5">Cliente: {leadName}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={saving}
            className="p-2 hover:bg-gray-100 rounded-lg transition text-gray-500 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Descreva o feedback do contato com o cliente:
              </label>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Ex: Cliente interessado em apostas esportivas. Demonstrou interesse em bônus de depósito..."
                className="w-full h-32 p-4 border-2 border-gray-700 rounded-xl focus:border-[#E86A24] focus:ring-2 focus:ring-[#E86A24]/20 outline-none transition-all resize-none text-sm text-gray-700"
                disabled={saving}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-100">
          <button
            onClick={handleClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !feedback.trim()}
            className="px-6 py-2 bg-[#E86A24] hover:bg-[#D95E1B] text-white text-sm font-bold rounded-xl transition-all shadow-md shadow-[#E86A24]/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Salvando...
              </>
            ) : (
              'Salvar'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ContactFeedbackModal;

