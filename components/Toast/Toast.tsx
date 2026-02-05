'use client';

import React, { useEffect, useState } from 'react';
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ToastProps {
  toast: Toast;
  onClose: (id: string) => void;
}

const Toast: React.FC<ToastProps> = ({ toast, onClose }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Trigger animation
    setTimeout(() => setIsVisible(true), 10);
    
    // Auto close after 4 seconds
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(() => onClose(toast.id), 300); // Wait for animation to finish
    }, 4000);

    return () => clearTimeout(timer);
  }, [toast.id, onClose]);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => onClose(toast.id), 300);
  };

  const bgColor = toast.type === 'success' 
    ? 'bg-[#8CD955]' 
    : toast.type === 'error' 
    ? 'bg-red-600' 
    : 'bg-amber-500';

  const icon = toast.type === 'success' 
    ? <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
    : toast.type === 'error' 
    ? <AlertCircle className="w-5 h-5 flex-shrink-0" />
    : <Info className="w-5 h-5 flex-shrink-0" />;

  return (
    <div
      className={`flex items-center gap-3 min-w-[320px] max-w-[500px] px-6 py-4 rounded-lg shadow-lg text-white transform transition-all duration-300 ease-out ${
        isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
      } ${bgColor}`}
    >
      {icon}
      <p className="flex-1 font-medium">{toast.message}</p>
      <button
        onClick={handleClose}
        className="hover:bg-white/20 rounded p-1 transition"
        aria-label="Fechar"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export default Toast;

