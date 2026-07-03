'use client';

import React, { useEffect } from 'react';
import { X, Smartphone, Clock, AlertCircle } from 'lucide-react';

interface QRCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  qrCode: string;
  qrTimer: number;
  qrExpired: boolean;
}

const QRCodeModal: React.FC<QRCodeModalProps> = ({
  isOpen,
  onClose,
  qrCode,
  qrTimer,
  qrExpired,
}) => {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && (qrExpired || qrTimer === 0)) {
          onClose();
        }
      }}
    >
      {/* Overlay — dark mode */}
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm min-h-full" />

      {/* Modal — responsivo: max-h e scroll interno */}
      <div
        className="relative w-full max-w-md max-h-[min(90vh,600px)] flex flex-col rounded-2xl shadow-2xl z-10 my-auto animate-in fade-in zoom-in duration-200 border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#333] rounded-t-2xl flex-shrink-0">
          <h2 className="text-lg sm:text-xl font-semibold text-gray-800 dark:text-gray-100 truncate pr-2">
            QR Code para Reconectar
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-[#404040] transition flex-shrink-0"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Conteúdo scrollável */}
        <div className="overflow-y-auto flex-1 px-4 sm:px-6 py-4 space-y-4 overscroll-contain">
          {/* Timer ou Status */}
          {qrTimer > 0 ? (
            <div className="flex flex-col items-center gap-2">
              <div className="inline-flex items-center gap-2 bg-red-500 dark:bg-red-600 text-white px-4 py-2.5 rounded-xl shadow-sm">
                <Clock className="w-5 h-5 flex-shrink-0" />
                <span className="text-2xl font-bold tabular-nums">{qrTimer}s</span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Tempo restante para escanear</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="inline-flex items-center gap-2 bg-gray-700 dark:bg-[#404040] text-white px-4 py-2.5 rounded-xl">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span className="text-lg font-medium">QR Expirado</span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
                O QR Code expirou. Verifique o status da instância.
              </p>
            </div>
          )}

          {/* QR Code */}
          <div className="flex justify-center">
            {qrCode && qrCode.trim() ? (
              (() => {
                const raw = qrCode.trim();
                const normalizeBase64 = (input: string): { src: string; meta: any } => {
                  const noSpaces = input.replace(/\s/g, '');
                  if (noSpaces.startsWith('data:image/')) {
                    return { src: noSpaces, meta: { kind: 'data-uri', length: noSpaces.length } };
                  }
                  const commaIdx = noSpaces.indexOf(',');
                  const maybePayload = commaIdx > -1 ? noSpaces.slice(commaIdx + 1) : noSpaces;
                  let b64 = maybePayload.replace(/-/g, '+').replace(/_/g, '/');
                  const pad = b64.length % 4;
                  if (pad === 2) b64 += '==';
                  else if (pad === 3) b64 += '=';
                  return { src: `data:image/png;base64,${b64}`, meta: { kind: 'base64', length: b64.length } };
                };
                const { src, meta } = normalizeBase64(raw);
                return (
                  <div className="p-4 rounded-xl bg-white dark:bg-[#1a1a1a] border-2 border-gray-200 dark:border-[#404040] shadow-inner">
                    <img
                      src={src}
                      alt="QR Code"
                      className="w-full max-w-[240px] sm:max-w-[280px] h-auto block mx-auto"
                      style={{ minHeight: 0 }}
                      onError={(e) => {
                        console.error('Erro ao carregar QR Code:', { qrCodeLength: qrCode.length, meta, error: e });
                      }}
                    />
                  </div>
                );
              })()
            ) : (
              <div className="w-full max-w-[280px] mx-auto p-6 sm:p-8 rounded-xl border-2 border-dashed border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#333] text-center">
                <p className="text-gray-500 dark:text-gray-400">QR Code não disponível</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">Aguarde ou verifique o status da instância</p>
              </div>
            )}
          </div>

          {/* Instruções */}
          <div className="flex flex-col items-center gap-2 pt-1 pb-2 text-center">
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              Escaneie este QR Code com o WhatsApp para reconectar a instância
            </p>
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 dark:bg-[#333] text-xs text-gray-600 dark:text-gray-400">
              <Smartphone className="w-4 h-4 flex-shrink-0 text-[#E86A24]" />
              <span>WhatsApp → Menu (☰) → Aparelhos conectados → Conectar um aparelho</span>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes zoom-in {
          from { transform: scale(0.95); }
          to { transform: scale(1); }
        }
        .animate-in {
          animation: fade-in 0.2s ease-out, zoom-in 0.2s ease-out;
        }
      `}</style>
    </div>
  );
};

export default QRCodeModal;
