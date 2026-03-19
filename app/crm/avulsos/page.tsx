'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { UserPlus, Search, Loader2, RefreshCw, AlertCircle, Phone, Building2 } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import ToastContainer from '@/components/Toast/ToastContainer';

type BancaOption = { id: string; name: string; url: string };

/** Cliente avulso (combo sem login) – estrutura genérica conforme API de exportação */
export interface ClienteAvulso {
  id?: number | string;
  name?: string;
  email?: string;
  phone?: string;
  telefone?: string;
  created_at?: string;
  _bancaId?: string;
  _bancaName?: string;
  [key: string]: unknown;
}

export default function AvulsosPage() {
  const { checking, userId } = useRequireAuth();
  const { toasts, removeToast } = useToast();
  const [clientes, setClientes] = useState<ClienteAvulso[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchPhone, setSearchPhone] = useState('');
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState<{ current_page?: number; last_page?: number; per_page?: number; total?: number; aggregated?: boolean } | null>(null);
  const [bancas, setBancas] = useState<BancaOption[]>([]);
  const [bancasLoading, setBancasLoading] = useState(true);
  const [bancaValue, setBancaValue] = useState<string>('all');

  useEffect(() => {
    if (!userId) return;
    const ctrl = new AbortController();
    (async () => {
      setBancasLoading(true);
      try {
        const res = await fetch('/api/crm/bancas', { headers: { 'X-User-Id': userId }, signal: ctrl.signal });
        const json = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(json?.data)) {
          setBancas(json.data);
          if (json.data.length > 0 && bancaValue === 'all') {
            setBancaValue('all');
          }
        }
      } finally {
        setBancasLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [userId]);

  const load = useCallback(
    async (pageNum: number = 1, telefone: string = '', banca: string = bancaValue) => {
      if (!userId) return;
      setLoading(true);
      setError(null);
      try {
        const url = new URL('/api/crm/clientes-avulsos', window.location.origin);
        if (telefone) {
          url.searchParams.set('telefone', telefone.replace(/\D/g, ''));
        } else {
          url.searchParams.set('page', String(pageNum));
          url.searchParams.set('per_page', '50');
        }
        if (banca && banca !== 'all') {
          url.searchParams.set('banca_url', banca);
        } else if (bancas.length > 0) {
          url.searchParams.set('banca_urls', bancas.map((b) => b.url).join(','));
        }
        const res = await fetch(url.toString(), { headers: { 'X-User-Id': userId } });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(json?.error || json?.message || `Erro ${res.status}`);
          setClientes([]);
          setMeta(null);
          return;
        }
        const data = Array.isArray(json.data) ? json.data : (json.data ? [json.data] : []);
        setClientes(data);
        setMeta(json.meta ?? null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Erro ao carregar clientes avulsos';
        setError(msg);
        setClientes([]);
        setMeta(null);
      } finally {
        setLoading(false);
      }
    },
    [userId, bancaValue, bancas]
  );

  useEffect(() => {
    if (!userId || searchPhone || bancasLoading) return;
    load(page, '', bancaValue);
  }, [userId, page, searchPhone, bancaValue, bancasLoading, load]);

  const handleSearchByPhone = () => {
    const digits = searchPhone.replace(/\D/g, '');
    if (!digits) {
      setSearchPhone('');
      setPage(1);
      load(1, '', bancaValue);
      return;
    }
    setPage(1);
    load(1, digits, bancaValue);
  };

  const handleClearSearch = () => {
    setSearchPhone('');
    setPage(1);
    load(1, '', bancaValue);
  };

  if (checking) {
    return (
      <Layout>
        <div className="flex min-h-[200px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <UserPlus className="h-7 w-7" />
              Clientes Avulsos
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Clientes criados na compra de combo sem login. Busca nas bancas do CRM.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {bancas.length > 0 && (
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <select
                  value={bancaValue}
                  onChange={(e) => {
                    setBancaValue(e.target.value);
                    setPage(1);
                  }}
                  disabled={bancasLoading || loading}
                  className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                >
                  <option value="all">Todas as Bancas</option>
                  {bancas.map((b) => (
                    <option key={b.id} value={b.url}>
                      {b.name || b.url}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex flex-1 items-center gap-2 rounded-md border bg-muted/30 px-2 sm:max-w-xs">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar por telefone"
                value={searchPhone}
                onChange={(e) => setSearchPhone(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearchByPhone()}
                className="min-w-0 flex-1 border-0 bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <button
              type="button"
              onClick={handleSearchByPhone}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Buscar
            </button>
            {searchPhone && (
              <button
                type="button"
                onClick={handleClearSearch}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
              >
                Limpar
              </button>
            )}
            <button
              type="button"
              onClick={() => (searchPhone ? handleClearSearch() : load(page, '', bancaValue))}
              disabled={loading}
              className="rounded-md border p-2 hover:bg-muted disabled:opacity-50"
              title="Atualizar"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertCircle className="h-5 w-5 shrink-0" />
            {error}
          </div>
        )}

        <div className="rounded-lg border bg-card">
          {loading && clientes.length === 0 ? (
            <div className="flex min-h-[200px] items-center justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : clientes.length === 0 ? (
            <div className="flex min-h-[200px] items-center justify-center p-8 text-sm text-muted-foreground">
              Nenhum cliente avulso encontrado.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      {meta?.aggregated && <th className="px-4 py-3 font-medium">Banca</th>}
                      <th className="px-4 py-3 font-medium">Nome</th>
                      <th className="px-4 py-3 font-medium">Telefone</th>
                      <th className="px-4 py-3 font-medium">E-mail</th>
                      <th className="px-4 py-3 font-medium">Criado em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientes.map((c, idx) => {
                      const phone = c.phone ?? c.telefone ?? '-';
                      const name = c.name ?? '-';
                      const email = c.email ?? '-';
                      const created = c.created_at
                        ? new Date(c.created_at).toLocaleDateString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                          })
                        : '-';
                      const bancaName = c._bancaName ?? '';
                      return (
                        <tr key={c.id ?? idx} className="border-b last:border-0 hover:bg-muted/30">
                          {meta?.aggregated && (
                            <td className="px-4 py-3 text-muted-foreground">{bancaName || '-'}</td>
                          )}
                          <td className="px-4 py-3">{name}</td>
                          <td className="px-4 py-3">{phone}</td>
                          <td className="px-4 py-3">{email}</td>
                          <td className="px-4 py-3">{created}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {meta && !searchPhone && (meta.last_page ?? 1) > 1 && (
                <div className="flex items-center justify-between border-t px-4 py-3">
                  <span className="text-xs text-muted-foreground">
                    Página {meta.current_page ?? 1} de {meta.last_page ?? 1} • Total: {meta.total ?? 0}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1 || loading}
                      className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      onClick={() => setPage((p) => p + 1)}
                      disabled={page >= (meta.last_page ?? 1) || loading}
                      className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                    >
                      Próxima
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </Layout>
  );
}
