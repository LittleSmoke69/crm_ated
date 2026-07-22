'use client';

import React, { useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import Button from './Button';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-7xl',
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  /** Ícone opcional ao lado do título */
  icon?: React.ReactNode;
  size?: ModalSize;
  /** Fecha ao clicar no overlay (padrão true) */
  closeOnOverlay?: boolean;
  /** Esconde o botão X (para modais obrigatórios) */
  hideClose?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Shell único de modal do app — substitui os 6+ estilos divergentes.
 * Fecha com ESC e clique no overlay, trava o scroll do body e usa a
 * superfície padrão (bg-white / dark #2a2a2a, rounded-2xl).
 */
export default function Modal({
  open,
  onClose,
  title,
  icon,
  size = 'md',
  closeOnOverlay = true,
  hideClose = false,
  footer,
  children,
  className = '',
}: ModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !hideClose) onClose();
    },
    [onClose, hideClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={closeOnOverlay && !hideClose ? onClose : undefined}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`w-full ${SIZE_CLASSES[size]} max-h-[90vh] flex flex-col rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] shadow-2xl ${className}`.trim()}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || !hideClose) && (
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-600 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              {icon && (
                <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-[#E86A2415] text-[#E86A24] shrink-0">
                  {icon}
                </span>
              )}
              {title && (
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                  {title}
                </h2>
              )}
            </div>
            {!hideClose && (
              <button
                onClick={onClose}
                className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#333] transition-colors"
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-200 dark:border-gray-600 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' para ações destrutivas (padrão), 'primary' para confirmações comuns */
  tone?: 'danger' | 'primary';
  loading?: boolean;
}

/** Diálogo de confirmação — substitui window.confirm()/alert() nativos. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'danger',
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description && (
        <p className="text-sm text-gray-600 dark:text-gray-300">{description}</p>
      )}
    </Modal>
  );
}
