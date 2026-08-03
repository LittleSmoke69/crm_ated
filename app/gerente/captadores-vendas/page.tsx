'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { BarChart3, Loader2, Trophy, Users, TrendingUp } from 'lucide-react';

type CaptadorStat = {
  id: string;
  name: string;
  email: string | null;
  total_leads: number;
  vendas_fechadas: number;
  taxa_vendas: number;
};

type Summary = {
  total_leads: number;
  total_vendas: number;
  taxa_geral: number;
};

export default function GerenteCaptadoresVendasPage() {
  const { checking, userId } = useRequireAuth();
  const [loading, setLoading] = useState(true);
  const [captadores, setCaptadores] = useState<CaptadorStat[]>([]);
  const [summary, setSummary] = useState<Summary>({ total_leads: 0, total_vendas: 0, taxa_geral: 0 });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/gerente/captadores-vendas', {
        headers: { 'X-User-Id': userId },
        credentials: 'include',
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Não foi possível carregar os dados.');
        return;
      }
      setCaptadores(json.data?.captadores ?? []);
      setSummary(json.data?.summary ?? { total_leads: 0, total_vendas: 0, taxa_geral: 0 });
    } catch {
      setError('Erro de conexão ao carregar a taxa de vendas.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  if (checking) {
    return (
      <Layout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-[#E86A24]" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <BarChart3 className="w-7 h-7 text-[#E86A24]" />
            Taxa de vendas — Captadores
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Conversão dos captadores da sua equipe: leads na coluna &quot;Convertido&quot; ou marcados como venda fechada.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard icon={<Users className="w-5 h-5" />} label="Total de leads" value={summary.total_leads} />
          <KpiCard icon={<Trophy className="w-5 h-5" />} label="Vendas fechadas" value={summary.total_vendas} accent="emerald" />
          <KpiCard icon={<TrendingUp className="w-5 h-5" />} label="Taxa geral" value={`${summary.taxa_geral}%`} accent="orange" />
        </div>

        <div className="rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] overflow-hidden">
          {loading ? (
            <div className="py-16 flex justify-center text-gray-400">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : error ? (
            <div className="p-6 text-center text-red-500 text-sm">{error}</div>
          ) : captadores.length === 0 ? (
            <div className="p-10 text-center text-gray-500 dark:text-gray-400 text-sm">
              Nenhum captador vinculado à sua equipe ou sem leads atribuídos.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-600 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    <th className="px-4 py-3.5">Captador</th>
                    <th className="px-4 py-3.5 text-right">Leads</th>
                    <th className="px-4 py-3.5 text-right">Vendas</th>
                    <th className="px-4 py-3.5 text-right">Taxa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {captadores.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-white/5">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-900 dark:text-white">{c.name}</div>
                        {c.email && <div className="text-xs text-gray-500 dark:text-gray-400">{c.email}</div>}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300">{c.total_leads}</td>
                      <td className="px-4 py-3 text-right font-medium text-emerald-600 dark:text-emerald-400">{c.vendas_fechadas}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`inline-flex min-w-[3.5rem] justify-end font-bold ${c.taxa_vendas >= 20 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-700 dark:text-gray-300'}`}>
                          {c.taxa_vendas}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

function KpiCard({
  icon,
  label,
  value,
  accent = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  accent?: 'default' | 'emerald' | 'orange';
}) {
  const accentClass =
    accent === 'emerald'
      ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
      : accent === 'orange'
        ? 'text-[#E86A24] bg-[#E86A24]/10 border-[#E86A24]/30'
        : 'text-gray-700 dark:text-gray-200 bg-gray-500/10 border-gray-300 dark:border-gray-600';

  return (
    <div className={`rounded-2xl border p-4 ${accentClass}`}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide opacity-80 mb-2">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
