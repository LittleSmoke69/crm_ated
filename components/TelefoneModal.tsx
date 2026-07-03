'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Phone, AlertCircle } from 'lucide-react';

interface TelefoneModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (telefone: string) => Promise<void>;
}

/** Modal obrigatório: usuário precisa cadastrar o telefone para continuar usando o Zaploto. */
const TelefoneModal: React.FC<TelefoneModalProps> = ({ isOpen, onClose, onSave }) => {
  const [telefone, setTelefone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Foca no input quando o modal abrir
  useEffect(() => {
    if (isOpen && inputRef.current) {
      // Pequeno delay para garantir que o modal esteja totalmente renderizado
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    } else if (!isOpen) {
      // Limpa o estado quando o modal fechar
      setTelefone('');
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!telefone.trim()) {
      setError('Por favor, informe seu número de telefone');
      return;
    }

    // Validação básica - deve ter pelo menos 10 dígitos (DDD + número)
    if (telefone.length < 10) {
      setError('Telefone inválido. Informe o DDD e o número (ex: 8195124779)');
      return;
    }

    try {
      setLoading(true);
      await onSave(telefone);
      setTelefone('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar telefone. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Remove tudo que não é número e limita a 11 dígitos (DDD + número)
    const digits = e.target.value.replace(/\D/g, '').slice(0, 11);
    setTelefone(digits);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" style={{ pointerEvents: 'auto' }}>
      <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-2xl max-w-md w-full p-6 relative animate-in fade-in zoom-in duration-200 border border-gray-200 dark:border-[#404040]">
        {/* Header - sem botão fechar: preenchimento obrigatório */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-[#E86A24] dark:bg-[#00ff00] bg-opacity-10 dark:bg-opacity-20 rounded-xl">
            <Phone className="w-6 h-6 text-[#E86A24] dark:text-[#00ff00]" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Cadastre seu telefone</h2>
            <p className="text-sm text-gray-500 dark:text-[#aaa]">Obrigatório para continuar no Zaploto</p>
          </div>
        </div>

        {/* Mensagem explicativa */}
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800 dark:text-blue-300">
              <p className="font-semibold mb-1">Por que precisamos do seu telefone?</p>
              <p className="text-blue-700 dark:text-blue-300">
                Este número será usado para enviar vídeos, comunicados e relatórios do zaploto diretamente para você via WhatsApp.
              </p>
            </div>
          </div>
        </div>

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="telefone" className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-2">
              Número de telefone
            </label>
            <input
              ref={inputRef}
              id="telefone"
              type="tel"
              value={telefone}
              onChange={handlePhoneChange}
              placeholder="8195124779"
              className="w-full px-4 py-3 border border-gray-300 dark:border-[#555] rounded-xl focus:ring-2 focus:ring-[#E86A24] dark:focus:ring-[#00ff00] focus:border-transparent outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-[#888] text-gray-900 dark:text-white dark:bg-[#333]"
              autoFocus
              disabled={loading}
              inputMode="numeric"
              pattern="[0-9]*"
            />
            <p className="mt-2 text-xs text-gray-500 dark:text-[#888]">
              Informe apenas números com DDD. Exemplo: 8195124779
            </p>
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Botão único: obrigatório preencher para continuar */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={loading || !telefone.trim() || telefone.length < 10}
              className="w-full px-4 py-3 bg-[#E86A24] dark:bg-[#00ff00] hover:bg-[#7BC844] dark:hover:bg-[#00e600] text-white rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Salvando...' : 'Continuar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TelefoneModal;
