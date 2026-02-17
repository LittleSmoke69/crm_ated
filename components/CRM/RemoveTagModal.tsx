'use client';

import React, { useState } from 'react';
import { X, Tag as TagIcon, Loader2 } from 'lucide-react';

interface Tag {
  id: string;
  label: string;
  color: string;
}

interface RemoveTagModalProps {
  isOpen: boolean;
  onClose: () => void;
  leadId: string | number;
  currentTags: Tag[];
  targetUserId?: string;
  onTagRemoved?: () => void;
}

const RemoveTagModal: React.FC<RemoveTagModalProps> = ({
  isOpen,
  onClose,
  leadId,
  currentTags,
  targetUserId,
  onTagRemoved,
}) => {
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRemoveTag = async (tagId: string) => {
    try {
      setRemoving(tagId);
      setError(null);

      const userId = typeof window !== 'undefined' 
        ? (sessionStorage.getItem('user_id') || localStorage.getItem('profile_id'))
        : null;
      
      if (!userId) {
        setError('Usuário não autenticado');
        return;
      }

      const url = new URL('/api/crm/leads/tags', window.location.origin);
      url.searchParams.append('leadId', leadId.toString());
      url.searchParams.append('tagId', tagId);
      if (targetUserId) {
        url.searchParams.append('targetUserId', targetUserId);
      }

      const response = await fetch(url.toString(), {
        method: 'DELETE',
        headers: {
          'X-User-Id': userId,
        },
      });

      const result = await response.json();

      if (result.success) {
        onTagRemoved?.();
        onClose();
      } else {
        setError(result.error || 'Erro ao remover etiqueta');
      }
    } catch (err) {
      console.error('[RemoveTagModal] Erro ao remover tag:', err);
      setError('Erro ao remover etiqueta');
    } finally {
      setRemoving(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md z-10 animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-800">Remover Etiqueta</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition text-gray-500 hover:text-gray-700"
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

          {currentTags.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <TagIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="font-semibold">Este lead não possui etiquetas</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar">
              {currentTags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => handleRemoveTag(tag.id)}
                  disabled={removing === tag.id}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:border-red-300 hover:bg-red-50/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div
                    className="w-4 h-4 rounded-full flex-shrink-0"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="flex-1 text-left font-semibold text-gray-700">
                    {tag.label}
                  </span>
                  {removing === tag.id ? (
                    <Loader2 className="w-4 h-4 animate-spin text-red-500" />
                  ) : (
                    <X className="w-4 h-4 text-gray-400" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RemoveTagModal;

