'use client';

import type { LinkProps } from 'next/link';
import WhitelabelLink from '@/components/WhitelabelLink';

export type TenantLinkProps = Omit<LinkProps & React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
};

/** Link que preserva o slug do white label (`/{slug}/...`). */
export function TenantLink({ href, ...props }: TenantLinkProps) {
  return <WhitelabelLink {...props} href={href} />;
}
