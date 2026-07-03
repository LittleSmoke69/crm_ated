'use client';

import { Suspense } from 'react';
import Link from '@/components/WhitelabelLink';
import { usePathname, useSearchParams } from 'next/navigation';
import { Kanban } from 'lucide-react';

const CRM_TABS = [
  { path: '/crm/kanban', hrefBase: '/crm/kanban', label: 'Kanban', Icon: Kanban },
] as const;

/**
 * Atalhos entre visões do CRM; preserva ?userId= quando o gerente/admin abre o pipeline de outro usuário.
 */
export default function CrmSubNav() {
  return (
    <Suspense fallback={<nav className="mb-4 h-9" aria-hidden />}>
      <CrmSubNavInner />
    </Suspense>
  );
}

function CrmSubNavInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const uid = searchParams.get('userId');
  const q = uid ? `?userId=${encodeURIComponent(uid)}` : '';

  return (
    <nav
      className="mb-4 flex flex-wrap gap-2"
      aria-label="Navegação do CRM"
    >
      {CRM_TABS.map(({ path, hrefBase, label, Icon }) => {
        const active = pathname === path || pathname?.startsWith(`${path}/`);
        const href = `${hrefBase}${q}`;
        return (
          <Link
            key={path}
            href={href}
            className={`
              inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-all
              ${active
                ? 'bg-[#E86A24] text-white shadow-md'
                : 'border border-gray-200 bg-white text-gray-600 hover:border-[#E86A24]/50 hover:bg-[#E86A24]/10 hover:text-[#C9531A] dark:border-[#404040] dark:bg-[#2a2a2a] dark:text-gray-300 dark:hover:bg-[#E86A24]/15 dark:hover:text-[#E86A24]'
              }
            `}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
