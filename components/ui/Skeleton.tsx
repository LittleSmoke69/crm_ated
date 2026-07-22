import React from 'react';

/** Bloco base de skeleton (animate-pulse). */
export default function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-gray-200 dark:bg-[#3a3a3a] ${className}`.trim()}
      aria-hidden="true"
    />
  );
}

/** Linhas de skeleton para tabelas (usar dentro de <tbody>). */
export function TableSkeletonRows({
  rows = 5,
  cols,
}: {
  rows?: number;
  cols: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-gray-100 dark:border-gray-700">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <Skeleton className="h-4 w-full max-w-[120px]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Skeleton com formato de StatCard. */
export function StatCardSkeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] p-4 ${className}`.trim()}
      aria-hidden="true"
    >
      <Skeleton className="h-3 w-20 mb-2" />
      <Skeleton className="h-7 w-28" />
    </div>
  );
}

/** Skeleton de card genérico (gráficos, listas). */
export function CardSkeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] p-4 sm:p-6 ${className}`.trim()}
      aria-hidden="true"
    >
      <Skeleton className="h-5 w-40 mb-4" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
