import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  // Raiz absoluta do Turbopack (process.cwd() = diretório do projeto ao rodar build)
  turbopack: { root: process.cwd() },
};

export default nextConfig;
