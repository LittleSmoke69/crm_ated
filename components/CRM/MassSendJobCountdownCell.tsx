'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { resolveInterGroupDelayMs, getDefaultInterGroupDelayMs } from '@/lib/crm/mass-send-inter-group-delay';

type JobSlice = {
  status: string;
  processed_index?: number | null;
  updated_at?: string | null;
  inter_group_delay_ms?: number | null;
  total_groups?: number | null;
};

export function MassSendJobCountdownCell({ job }: { job: JobSlice }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const delayMs = resolveInterGroupDelayMs(job.inter_group_delay_ms);
  const delaySec = Math.max(1, Math.round(delayMs / 1000));
  const defaultSec = Math.max(1, Math.round(getDefaultInterGroupDelayMs() / 1000));
  const usesCustom = job.inter_group_delay_ms != null && Number(job.inter_group_delay_ms) > 0;

  const total = Number(job.total_groups) || 0;
  const idx = Number(job.processed_index) || 0;
  const active =
    (job.status === 'processing' || job.status === 'pending') && idx < total && total > 0;

  const showCountdown = active && idx > 0 && job.updated_at;

  const remainingSec = useMemo(() => {
    if (!showCountdown || !job.updated_at) return null;
    const target = new Date(job.updated_at).getTime() + delayMs;
    return Math.max(0, Math.ceil((target - now) / 1000));
  }, [showCountdown, job.updated_at, delayMs, now]);

  return (
    <div className="text-xs text-gray-600 dark:text-gray-400 leading-tight">
      <div>
        {usesCustom ? (
          <>
            Entre grupos: <span className="font-semibold text-gray-800 dark:text-gray-200">{delaySec}s</span>
          </>
        ) : (
          <>
            Padrão: <span className="font-semibold text-gray-800 dark:text-gray-200">{defaultSec}s</span>
          </>
        )}
      </div>
      {active && showCountdown && remainingSec != null && (
        <div className="text-[#C9531A] dark:text-[#E86A24] font-semibold tabular-nums mt-0.5">
          {remainingSec > 0 ? `Próximo ~${remainingSec}s` : 'Disparando…'}
        </div>
      )}
    </div>
  );
}
