'use client';

import React from 'react';
import NextLink, { type LinkProps } from 'next/link';
import { useTenantHref } from '@/lib/utils/tenant-href';

type WhitelabelLinkProps = LinkProps & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps>;

/**
 * Substitui `next/link` em rotas internas: prefixa o slug do white label (`/tenant/...`).
 * Href externo, `mailto:`, etc. passam sem alteração.
 */
export default function WhitelabelLink({ href, ...rest }: WhitelabelLinkProps) {
  const tenantHref = useTenantHref();
  const resolved =
    typeof href === 'string' && href.startsWith('/') && !href.startsWith('//')
      ? tenantHref(href)
      : href;
  return <NextLink href={resolved} {...rest} />;
}
