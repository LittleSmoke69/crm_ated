'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, Phone, AlertCircle } from 'lucide-react';

interface TelefoneModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (telefone: string) => Promise<void>;
}

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
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 relative animate-in fade-in zoom-in duration-200">
        {/* Botão fechar */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Fechar"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-[#8CD955] bg-opacity-10 rounded-xl">
            <Phone className="w-6 h-6 text-[#8CD955]" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Cadastre seu telefone</h2>
            <p className="text-sm text-gray-500">Número pessoal</p>
          </div>
        </div>

        {/* Mensagem explicativa */}
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p className="font-semibold mb-1">Por que precisamos do seu telefone?</p>
              <p className="text-blue-700">
                Este número será usado para enviar vídeos, comunicados e relatórios do zaploto diretamente para você via WhatsApp.
              </p>
            </div>
          </div>
        </div>

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="telefone" className="block text-sm font-medium text-gray-700 mb-2">
              Número de telefone
            </label>
            <input
              ref={inputRef}
              id="telefone"
              type="tel"
              value={telefone}
              onChange={handlePhoneChange}
              placeholder="8195124779"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#8CD955] focus:border-transparent outline-none transition-all placeholder:text-gray-400 text-gray-900"
              autoFocus
              disabled={loading}
              inputMode="numeric"
              pattern="[0-9]*"
            />
            <p className="mt-2 text-xs text-gray-500">
              Informe apenas números com DDD. Exemplo: 8195124779
            </p>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Botões */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-3 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl font-medium transition-colors disabled:opacity-50"
            >
              Depois
            </button>
            <button
              type="submit"
              disabled={loading || !telefone.trim()}
              className="flex-1 px-4 py-3 bg-[#8CD955] hover:bg-[#7BC844] text-white rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TelefoneModal;
