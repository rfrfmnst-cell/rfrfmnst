import { fileURLToPath } from 'node:url';

import { withSecurityHeaders } from '../../config/security-headers.mjs';

const standaloneOutput =
  process.env.VERCEL === '1'
    ? {}
    : {
        output: 'standalone',
        outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
      };

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...standaloneOutput,
  transpilePackages: [
    '@rafraf/ui',
    '@rafraf/brand',
    '@rafraf/db',
    '@rafraf/shared',
  ],
  serverExternalPackages: ['@prisma/client'],
};

export default withSecurityHeaders(nextConfig);
