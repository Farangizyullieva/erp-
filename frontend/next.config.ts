import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Server texnologiyasini oshkor qilmaslik
  poweredByHeader: false,
  // Monorepo ildizi: uy papkasidagi boshqa lockfile'lar bilan adashmasligi uchun
  outputFileTracingRoot: path.join(__dirname, '..'),
  // Loyihaning o'z ESLint konfiguratsiyasi hali yo'q; usiz Next uy papkasidagi begona eslint.config.mjs ni topib oladi
  eslint: { ignoreDuringBuilds: true },
};

export default config;
