import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: '/chat-atendimento', destination: '/chat', permanent: false },
    ];
  },
  // Skip type checking during Docker build (handled in dev/CI).
  // Next 16 não roda lint no build, então não há flag equivalente para eslint aqui.
  typescript: { ignoreBuildErrors: true },
  images: { unoptimized: true },
  /** Binário nativo do ffmpeg-static — não empacotar no bundle do servidor */
  serverExternalPackages: ['ffmpeg-static'],
  // Raiz absoluta do Turbopack (process.cwd() = diretório do projeto ao rodar build)
  turbopack: { root: process.cwd() },
  /**
   * Webhooks Evolution: JSON com mídia em base64 excede o padrão (10MB).
   * Next.js faz buffer do body para middleware/proxy; sem isso só os primeiros 10MB chegam na rota.
   * @see https://nextjs.org/docs/app/api-reference/config/next-config-js/middlewareClientMaxBodySize
   */
  experimental: {
    proxyClientMaxBodySize: '50mb',
  },
};

export default nextConfig;
