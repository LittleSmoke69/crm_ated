import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  // Evita aviso de múltiplos lockfiles: usa o diretório do app como raiz do Turbopack
  turbopack: { root: '.' },
};

export default nextConfig;
