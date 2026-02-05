'use client';

import React, { useEffect } from 'react';
import { X } from 'lucide-react';

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
  // Fecha o modal ao pressionar ESC
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Previne scroll do body quando modal está aberto
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        // Só permite fechar clicando no overlay se o QR expirou ou se o timer chegou a 0
        // Caso contrário, o modal permanece aberto durante os 30 segundos
        if (e.target === e.currentTarget && (qrExpired || qrTimer === 0)) {
          onClose();
        }
      }}
    >
      {/* Overlay escuro */}
      <div className="absolute inset-0 bg-white/75 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl p-6 max-w-md w-full z-10 animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-800">QR Code para Reconectar</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition text-gray-500 hover:text-gray-700"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Timer ou Status */}
        {qrTimer > 0 ? (
          <div className="text-center mb-4">
            <div className="inline-block bg-red-500 text-white px-4 py-2 rounded-lg">
              <span className="text-2xl font-bold">{qrTimer}s</span>
            </div>
            <p className="text-sm text-gray-600 mt-2">Tempo restante para escanear</p>
          </div>
        ) : (
          <div className="text-center mb-4">
            <div className="inline-block bg-gray-800 text-white px-4 py-2 rounded-lg">
              <span className="text-lg">QR Expirado</span>
            </div>
            <p className="text-sm text-gray-600 mt-2">O QR Code expirou. Verifique o status da instância.</p>
          </div>
        )}

        {/* QR Code */}
        <div className="flex justify-center mb-4">
          {qrCode && qrCode.trim() ? (
            (() => {
              const raw = qrCode.trim();

              // Aceita:
              // - data:image/...;base64,XXXX
              // - base64 puro
              // - base64url (- e _), com ou sem padding
              const normalizeBase64 = (input: string): { src: string; meta: any } => {
                const noSpaces = input.replace(/\s/g, '');
                if (noSpaces.startsWith('data:image/')) {
                  return { src: noSpaces, meta: { kind: 'data-uri', length: noSpaces.length } };
                }

                // Se vier com prefixo data: mas não image, tenta extrair após vírgula
                const commaIdx = noSpaces.indexOf(',');
                const maybePayload = commaIdx > -1 ? noSpaces.slice(commaIdx + 1) : noSpaces;

                // base64url -> base64
                let b64 = maybePayload.replace(/-/g, '+').replace(/_/g, '/');
                const pad = b64.length % 4;
                if (pad === 2) b64 += '==';
                else if (pad === 3) b64 += '=';

                return { src: `data:image/png;base64,${b64}`, meta: { kind: 'base64', length: b64.length } };
              };

              const { src, meta } = normalizeBase64(raw);

              return (
                <div className="p-4 bg-white border-2 border-gray-200 rounded-lg">
                  <img
                    src={src}
                    alt="QR Code"
                    className="max-w-full h-auto"
                    onError={(e) => {
                      console.error('Erro ao carregar QR Code:', {
                        qrCodeLength: qrCode.length,
                        meta,
                        error: e
                      });
                    }}
                    onLoad={() => {
                      console.log('QR Code carregado com sucesso');
                    }}
                  />
                </div>
              );
            })()
          ) : (
            <div className="p-8 border-2 border-gray-200 rounded-lg bg-gray-50 text-center w-full">
              <p className="text-gray-500">QR Code não disponível</p>
              <p className="text-xs text-gray-400 mt-2">Aguarde ou verifique o status da instância</p>
            </div>
          )}
        </div>

        {/* Instruções */}
        <div className="text-center">
          <p className="text-sm text-gray-600 mb-2">
            Escaneie este QR Code com o WhatsApp para reconectar a instância
          </p>
          <p className="text-xs text-gray-500">
            Abra o WhatsApp → Menu (☰) → Aparelhos conectados → Conectar um aparelho
          </p>
        </div>
      </div>

      <style jsx>{`
        @keyframes fade-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes zoom-in {
          from {
            transform: scale(0.95);
          }
          to {
            transform: scale(1);
          }
        }
        .animate-in {
          animation: fade-in 0.2s ease-out, zoom-in 0.2s ease-out;
        }
      `}</style>
    </div>
  );
};

export default QRCodeModal;

