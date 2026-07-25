'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Search, CheckCircle2, XCircle, Eye, MousePointerClick } from 'lucide-react';

interface EmailLog {
  id: string;
  recipient: string;
  subject: string;
  template_key: string | null;
  category: 'transactional' | 'newsletter' | 'test';
  status: 'sent' | 'failed';
  error: string | null;
  created_at: string;
  opened_at: string | null;
  open_count: number;
  clicked_at: string | null;
  click_count: number;
  last_clicked_url: string | null;
}

interface Stats {
  sent_today: number;
  failed_today: number;
  newsletter_today: number;
  opened_today: number;
  clicked_today: number;
}

const inputClass =
  'w-full px-3 py-2 min-h-[40px] border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#E86A24]/30 focus:border-[#E86A24] transition-colors';

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return '';
  }
}

const CATEGORY_LABEL: Record<EmailLog['category'], string> = {
  transactional: 'Transacional',
  newsletter: 'Campanha',
  test: 'Teste',
};

export default function EmailLogsHistory({ userId }: { userId: string }) {
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [interaction, setInteraction] = useState('');

  const headers = useCallback((): Record<string, string> => ({
    'Content-Type': 'application/json',
    'X-User-Id': userId,
  }), [userId]);

  const load = useCallback(async (targetPage = 1) => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      sp.set('limit', String(pageSize));
      sp.set('offset', String((targetPage - 1) * pageSize));
      if (search.trim()) sp.set('search', search.trim());
      if (status) sp.set('status', status);
      if (category) sp.set('category', category);
      if (interaction) sp.set('interaction', interaction);

      const res = await fetch(`/api/admin/email-logs?${sp.toString()}`, { headers: headers() });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Erro ao carregar histórico');
      setLogs(json.data.logs || []);
      setTotal(json.data.total || 0);
      setStats(json.data.stats || null);
      setPage(targetPage);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [headers, search, status, category, interaction]);

  useEffect(() => { load(1); }, [status, category, interaction]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            ['Enviados hoje', stats.sent_today, 'text-emerald-600 dark:text-emerald-400'],
            ['Falhas hoje', stats.failed_today, 'text-red-600 dark:text-red-400'],
            ['Campanhas hoje', stats.newsletter_today, 'text-blue-600 dark:text-blue-400'],
            ['Aberturas hoje', stats.opened_today, 'text-amber-600 dark:text-amber-400'],
            ['Cliques hoje', stats.clicked_today, 'text-violet-600 dark:text-violet-400'],
          ].map(([label, value, cls]) => (
            <div key={label as string} className="rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] p-3">
              <div className={`text-xl font-bold ${cls}`}>{value}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="relative sm:col-span-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') load(1); }}
              placeholder="E-mail ou assunto"
              className={`${inputClass} pl-9`}
            />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
            <option value="">Todos os status</option>
            <option value="sent">Enviado</option>
            <option value="failed">Falhou</option>
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
            <option value="">Todas as categorias</option>
            <option value="transactional">Transacional</option>
            <option value="newsletter">Campanha</option>
            <option value="test">Teste</option>
          </select>
          <select value={interaction} onChange={(e) => setInteraction(e.target.value)} className={inputClass}>
            <option value="">Qualquer engajamento</option>
            <option value="opened">Abriram</option>
            <option value="not_opened">Não abriram</option>
            <option value="clicked">Clicaram</option>
            <option value="not_clicked">Não clicaram</option>
          </select>
        </div>
        <button onClick={() => load(1)} className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-[#E86A24] hover:bg-[#D95E1B]">Buscar</button>
      </div>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-600 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Destinatário</th>
                <th className="px-4 py-3">Assunto</th>
                <th className="px-4 py-3">Categoria</th>
                <th className="px-4 py-3">Engajamento</th>
                <th className="px-4 py-3">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Nenhum e-mail encontrado.</td></tr>
              ) : (
                logs.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                    <td className="px-4 py-3">
                      {l.status === 'sent' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs font-bold"><CheckCircle2 className="w-3.5 h-3.5" /> Enviado</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 text-xs font-bold" title={l.error || ''}><XCircle className="w-3.5 h-3.5" /> Falhou</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">{l.recipient}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 max-w-xs truncate" title={l.subject}>{l.subject}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{CATEGORY_LABEL[l.category]}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                        <span className={`inline-flex items-center gap-1 ${l.opened_at ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''}`}>
                          <Eye className="w-3.5 h-3.5" /> {l.open_count}
                        </span>
                        <span className={`inline-flex items-center gap-1 ${l.clicked_at ? 'text-violet-600 dark:text-violet-400 font-semibold' : ''}`}>
                          <MousePointerClick className="w-3.5 h-3.5" /> {l.click_count}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDateTime(l.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-600 text-sm">
            <span className="text-gray-500 dark:text-gray-400">{total} e-mail(s) — página {page} de {totalPages}</span>
            <div className="flex gap-2">
              <button onClick={() => load(page - 1)} disabled={page <= 1 || loading} className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-40">Anterior</button>
              <button onClick={() => load(page + 1)} disabled={page >= totalPages || loading} className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 disabled:opacity-40">Próxima</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
