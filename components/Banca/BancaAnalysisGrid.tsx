'use client';

/**
 * Grid de cards "Análise da Banca" escopado por papel:
 *  - admin/super: todas as bancas com Ads ativo no período.
 *  - dono_banca: própria banca.
 *  - gestor: bancas vinculadas.
 *
 * A lista vem de GET /api/banca-analysis/bancas (escopo resolvido no servidor).
 */

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import BancaAnalysisCard from '@/components/Banca/BancaAnalysisCard';

interface BancaItem {
  id: string;
  name: string;
}

export default function BancaAnalysisGrid({
  userId,
  dateFrom,
  dateTo,
}: {
  userId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
}) {
  const [bancas, setBancas] = useState<BancaItem[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    fetch(`/api/banca-analysis/bancas?${params.toString()}`, { headers: { 'X-User-Id': userId } })
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        setBancas(res?.success && Array.isArray(res.data?.bancas) ? (res.data.bancas as BancaItem[]) : []);
      })
      .catch(() => {
        if (!cancelled) setBancas([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, dateFrom, dateTo]);

  if (loading && !bancas) {
    return (
      <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-emerald-500" /> Carregando análises das bancas…
      </div>
    );
  }

  if (!bancas || bancas.length === 0) {
    return (
      <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 text-sm text-gray-500 dark:text-gray-400">
        Nenhuma banca com campanha ativa no período.
      </div>
    );
  }

  // 1 banca → card cheio; várias → grid lado a lado.
  if (bancas.length === 1) {
    return (
      <BancaAnalysisCard
        bancaId={bancas[0].id}
        userId={userId}
        dateFrom={dateFrom}
        dateTo={dateTo}
        bancaName={bancas[0].name}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4 items-start">
      {bancas.map((b) => (
        <BancaAnalysisCard
          key={b.id}
          bancaId={b.id}
          userId={userId}
          dateFrom={dateFrom}
          dateTo={dateTo}
          bancaName={b.name}
          lazy
          compact
        />
      ))}
    </div>
  );
}
