'use client';

import React, { useEffect, useState } from 'react';
import { Shield, Loader2, Users, Search, UserX } from 'lucide-react';

const STEPS = [
  { label: 'Buscando grupos monitorados...', icon: Users },
  { label: 'Consultando participantes de cada grupo...', icon: Search },
  { label: 'Identificando números na lista negra...', icon: UserX },
  { label: 'Removendo números dos grupos (pode levar alguns minutos)...', icon: Shield },
];

const STEP_INTERVAL_MS = 2500;

interface VerifyGroupsOverlayProps {
  isActive: boolean;
}

export default function VerifyGroupsOverlay({ isActive }: VerifyGroupsOverlayProps) {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!isActive) {
      setStepIndex(0);
      return;
    }
    const id = setInterval(() => {
      setStepIndex((i) => (i + 1) % STEPS.length);
    }, STEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isActive]);

  if (!isActive) return null;

  const step = STEPS[stepIndex];
  const Icon = step.icon;

  return (
    <div
      className="rounded-xl border-2 border-[#8CD955]/60 bg-[#8CD955]/5 dark:bg-[#8CD955]/10 shadow-lg overflow-hidden mb-6 animate-in fade-in duration-300"
      role="status"
      aria-live="polite"
      aria-label="Verificação de grupos em andamento"
    >
      <div className="flex items-center gap-4 p-4 md:p-5">
        <div className="relative flex shrink-0">
          <div className="absolute inset-0 rounded-full bg-[#8CD955]/30 animate-ping" />
          <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-[#8CD955] text-white">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Icon className="h-4 w-4 text-[#8CD955] shrink-0" />
            {step.label}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Rodando em segundo plano — você pode continuar usando a página.
          </p>
        </div>
      </div>
      <div className="h-1.5 w-full bg-gray-200 dark:bg-gray-700 overflow-hidden rounded-b-xl">
        <div className="h-full w-1/3 bg-[#8CD955] rounded-r-full animate-verify-progress" />
      </div>
    </div>
  );
}
