'use client';

import { useMemo, useState, useId } from 'react';
import { Search, User, X } from 'lucide-react';

export interface ConsultantPickerOption {
  id: string;
  full_name: string | null;
  email: string | null;
  status?: string | null;
}

function labelFor(c: ConsultantPickerOption): string {
  const name = c.full_name?.trim() || '';
  const email = c.email?.trim() || '';
  const role = c.status?.trim() || '';
  const base = name && email ? `${name} — ${email}` : name || email || c.id.slice(0, 8);
  return role ? `${base} (${role})` : base;
}

function normalizeSearch(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function matchesQuery(c: ConsultantPickerOption, q: string): boolean {
  if (!q.trim()) return true;
  const n = normalizeSearch(q);
  const hay = normalizeSearch(`${c.full_name ?? ''} ${c.email ?? ''} ${c.status ?? ''} ${c.id}`);
  return hay.includes(n);
}

/**
 * Escolha opcional de usuário/consultor com busca por nome, e-mail ou perfil.
 */
export default function ConsultantSearchPicker({
  value,
  onChange,
  options,
  loading = false,
  emptyListHint,
  inputClass,
}: {
  value: string;
  onChange: (consultantId: string) => void;
  options: ConsultantPickerOption[];
  loading?: boolean;
  emptyListHint?: string;
  inputClass: string;
}) {
  const baseId = useId();
  const searchId = `${baseId}-search`;
  const [query, setQuery] = useState('');

  const selected = useMemo(() => options.find((c) => c.id === value) ?? null, [options, value]);

  const filtered = useMemo(() => {
    return options.filter((c) => matchesQuery(c, query));
  }, [options, query]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" aria-hidden />
        <input
          id={searchId}
          type="search"
          autoComplete="off"
          placeholder="Buscar por nome, e-mail ou perfil…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`${inputClass} pl-9`}
          disabled={loading}
          aria-label="Filtrar lista de usuários"
        />
      </div>

      {selected && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#E86A24]/15 border border-[#E86A24]/40 text-sm">
          <span className="flex items-center gap-2 min-w-0 text-gray-800 dark:text-white">
            <User className="w-4 h-4 shrink-0 text-[#6fb83d]" aria-hidden />
            <span className="truncate font-medium">{labelFor(selected)}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              onChange('');
              setQuery('');
            }}
            className="shrink-0 p-1 rounded-md text-gray-600 dark:text-[#aaa] hover:bg-black/10 dark:hover:bg-white/10"
            title="Remover vínculo (opcional)"
            aria-label="Limpar usuário selecionado"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div
        className="border border-gray-200 dark:border-[#555] rounded-xl bg-white dark:bg-[#1e1e1e] max-h-52 overflow-y-auto overscroll-contain shadow-inner"
        role="listbox"
        aria-label="Lista de usuários"
      >
        <button
          type="button"
          role="option"
          aria-selected={!value}
          onClick={() => {
            onChange('');
            setQuery('');
          }}
          className={`w-full text-left px-3 py-2.5 text-sm border-b border-gray-100 dark:border-[#333] transition ${
            !value ? 'bg-[#E86A24]/20 font-medium text-gray-900 dark:text-white' : 'text-gray-700 dark:text-[#ccc] hover:bg-gray-50 dark:hover:bg-[#2a2a2a]'
          }`}
        >
          Nenhum (sem usuário vinculado)
        </button>
        {loading && (
          <p className="px-3 py-4 text-xs text-gray-500 dark:text-[#888] text-center">Carregando usuários…</p>
        )}
        {!loading && options.length === 0 && emptyListHint && (
          <p className="px-3 py-3 text-xs text-gray-500 dark:text-[#888] leading-relaxed">{emptyListHint}</p>
        )}
        {!loading &&
          filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={value === c.id}
              onClick={() => onChange(c.id)}
              className={`w-full text-left px-3 py-2 text-sm border-b border-gray-50 dark:border-[#333] last:border-0 transition ${
                value === c.id
                  ? 'bg-[#E86A24]/15 font-medium text-gray-900 dark:text-white'
                  : 'text-gray-700 dark:text-[#ccc] hover:bg-gray-50 dark:hover:bg-[#2a2a2a]'
              }`}
            >
              {labelFor(c)}
            </button>
          ))}
        {!loading && options.length > 0 && filtered.length === 0 && (
          <p className="px-3 py-4 text-xs text-gray-500 dark:text-[#888] text-center">Nenhum resultado para “{query.trim()}”.</p>
        )}
      </div>
      <p className="text-[11px] text-gray-500 dark:text-[#777]">
        Opcional: vincule um usuário ao grupo ou deixe sem vínculo.
      </p>
    </div>
  );
}
