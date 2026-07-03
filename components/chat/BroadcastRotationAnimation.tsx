'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface RotationInstance {
  id: string;
  name: string;
}

interface BroadcastRotationAnimationProps {
  instances: RotationInstance[];
  /** Disparo em andamento — anima envios entre instâncias. */
  active?: boolean;
  /** Instância que enviou por último (destaque + animação sequencial). */
  highlightInstanceId?: string | null;
  rotationSize?: number;
  compact?: boolean;
  className?: string;
}

type FlyingMessage = { key: number; fromIdx: number; toIdx: number };

export default function BroadcastRotationAnimation({
  instances,
  active = false,
  highlightInstanceId = null,
  rotationSize = 1,
  compact = false,
  className = '',
}: BroadcastRotationAnimationProps) {
  const svgId = useId().replace(/:/g, '');
  const VIEW_W = 320;
  const VIEW_H = compact ? 160 : 200;
  const CENTER_X = VIEW_W / 2;
  const CENTER_Y = compact ? 72 : 88;
  const RADIUS = compact ? 52 : 64;

  const positions = useMemo(() => {
    if (instances.length === 0) return [] as Array<RotationInstance & { x: number; y: number; idx: number }>;
    if (instances.length === 1) {
      return [{ ...instances[0], x: CENTER_X, y: CENTER_Y, idx: 0 }];
    }
    return instances.map((chip, idx) => {
      const angle = (idx / instances.length) * 2 * Math.PI - Math.PI / 2;
      return {
        ...chip,
        idx,
        x: CENTER_X + RADIUS * Math.cos(angle),
        y: CENTER_Y + RADIUS * Math.sin(angle),
      };
    });
  }, [instances]);

  const [messages, setMessages] = useState<FlyingMessage[]>([]);
  const keyRef = useRef(0);
  const prevHighlightRef = useRef<string | null>(null);
  const previewIdxRef = useRef(0);

  const highlightIdx = useMemo(() => {
    if (!highlightInstanceId) return -1;
    return positions.findIndex((p) => p.id === highlightInstanceId);
  }, [highlightInstanceId, positions]);

  const pushMessage = (fromIdx: number, toIdx: number) => {
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
    const key = ++keyRef.current;
    setMessages((prev) => [...prev, { key, fromIdx, toIdx }]);
    window.setTimeout(() => {
      setMessages((prev) => prev.filter((m) => m.key !== key));
    }, 1500);
  };

  // Animação sequencial quando a instância ativa muda (disparo real).
  useEffect(() => {
    if (!active || positions.length < 2 || !highlightInstanceId) return;
    const currentIdx = positions.findIndex((p) => p.id === highlightInstanceId);
    if (currentIdx < 0) return;

    const prevId = prevHighlightRef.current;
    prevHighlightRef.current = highlightInstanceId;

    if (prevId == null) return;

    const prevIdx = positions.findIndex((p) => p.id === prevId);
    if (prevIdx < 0) return;

    pushMessage(prevIdx, currentIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, highlightInstanceId, positions]);

  // Prévia da rotação (formulário / idle): percorre instâncias em ordem.
  useEffect(() => {
    if (active || positions.length < 2) return;
    let alive = true;
    previewIdxRef.current = 0;

    const tick = () => {
      if (!alive) return;
      const fromIdx = previewIdxRef.current;
      const toIdx = (fromIdx + 1) % positions.length;
      pushMessage(fromIdx, toIdx);
      previewIdxRef.current = toIdx;
    };

    tick();
    const interval = window.setInterval(tick, 1800);
    return () => {
      alive = false;
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, positions.length]);

  if (instances.length === 0) return null;

  if (instances.length === 1) {
    return (
      <div
        className={`rounded-lg border border-dashed border-gray-200 bg-gray-50/80 px-3 py-2 text-center text-[11px] text-gray-500 dark:border-[#404040] dark:bg-[#252525] dark:text-gray-400 ${className}`}
      >
        Uma instância — sem rotação.
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-gray-200 bg-gradient-to-b from-gray-50 to-white dark:border-[#404040] dark:from-[#1e1e1e] dark:to-[#2a2a2a] ${className}`}
    >
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className={compact ? 'h-40 w-full' : 'h-48 w-full'}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        <defs>
          <radialGradient id={`${svgId}-active`} cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#EF9057" />
            <stop offset="100%" stopColor="#E86A24" />
          </radialGradient>
          <radialGradient id={`${svgId}-idle`} cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#94a3b8" />
            <stop offset="100%" stopColor="#64748b" />
          </radialGradient>
        </defs>

        {positions.map((from, i) =>
          positions.slice(i + 1).map((to, j) => (
            <line
              key={`line-${i}-${j}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="#E86A24"
              strokeOpacity={0.1}
              strokeWidth={1}
            />
          ))
        )}

        {messages.map((m) => {
          const from = positions[m.fromIdx];
          const to = positions[m.toIdx];
          if (!from || !to) return null;
          const pathId = `${svgId}-path-${m.key}`;
          return (
            <path
              key={pathId}
              id={pathId}
              d={`M ${from.x} ${from.y} L ${to.x} ${to.y}`}
              fill="none"
              stroke="none"
            />
          );
        })}

        {messages.map((m) => {
          const from = positions[m.fromIdx];
          const to = positions[m.toIdx];
          if (!from || !to) return null;
          const pathId = `${svgId}-path-${m.key}`;
          return (
            <g key={`fly-${m.key}`}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="#E86A24"
                strokeOpacity={0.35}
                strokeWidth={1.5}
              />
              <circle r={5} fill="#E86A24">
                <animateMotion dur="1.35s" begin="0s" fill="freeze" repeatCount="1">
                  <mpath href={`#${pathId}`} />
                </animateMotion>
                <animate
                  attributeName="opacity"
                  values="0;1;1;0"
                  keyTimes="0;0.08;0.88;1"
                  dur="1.35s"
                  fill="freeze"
                />
              </circle>
            </g>
          );
        })}

        {positions.map((p) => {
          const isHighlight = p.idx === highlightIdx;
          const initials =
            p.name
              .split(/\s+/)
              .map((s) => s[0])
              .filter(Boolean)
              .slice(0, 2)
              .join('')
              .toUpperCase() || '?';

          return (
            <g key={p.id}>
              {(active || isHighlight) && (
                <circle cx={p.x} cy={p.y} r={22} fill="#E86A24" opacity={isHighlight ? 0.28 : 0.12}>
                  <animate attributeName="r" values="18;26;18" dur="2.2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.28;0.08;0.28" dur="2.2s" repeatCount="indefinite" />
                </circle>
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={16}
                fill={isHighlight ? `url(#${svgId}-active)` : `url(#${svgId}-idle)`}
                stroke={isHighlight ? '#fff' : '#e2e8f0'}
                strokeWidth={isHighlight ? 2.5 : 1.5}
              />
              <text
                x={p.x}
                y={p.y}
                textAnchor="middle"
                dy=".32em"
                fontSize="9"
                fontWeight="700"
                fill="white"
              >
                {initials}
              </text>
              {!compact && (
                <text x={p.x} y={p.y + 28} textAnchor="middle" fontSize="8" fill="#64748b">
                  {p.name.length > 12 ? `${p.name.slice(0, 10)}…` : p.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="absolute right-2 top-2 text-[9px] font-semibold uppercase tracking-wide">
        {active ? (
          <span className="inline-flex items-center gap-1 text-[#E86A24]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#E86A24]" />
            Rotação ativa
          </span>
        ) : (
          <span className="text-gray-400 dark:text-gray-500">Prévia da rotação</span>
        )}
      </div>

      {rotationSize > 1 && (
        <p className="border-t border-gray-100 px-2 py-1.5 text-center text-[10px] text-gray-500 dark:border-[#333] dark:text-gray-400">
          {rotationSize} contato(s) por instância antes de alternar
        </p>
      )}
    </div>
  );
}
