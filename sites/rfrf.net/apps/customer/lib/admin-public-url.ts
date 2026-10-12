export interface AdminPublicUrlEnvironment {
  nodeEnv?: string;
  adminPublicUrl?: string;
}

const LOCAL_ADMIN_URL = 'http://localhost:3003';

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1' ||
    normalized === '0.0.0.0' ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

/**
 * Resolves the operations-console origin without trusting request headers.
 *
 * Production deliberately has no baked-in deployment URL: Preview and
 * Production must bind their own canonical origin through ADMIN_PUBLIC_URL so
 * customer notifications cannot silently drift to an obsolete deployment.
 */
export function adminPublicUrl({
  nodeEnv,
  adminPublicUrl: configuredValue,
}: AdminPublicUrlEnvironment): string | null {
  const configured = configuredValue?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      const loopback = isLoopbackHostname(url.hostname);
      const localDevelopmentUrl =
        nodeEnv !== 'production' && url.protocol === 'http:' && loopback;
      const secureUrl =
        url.protocol === 'https:' && (nodeEnv !== 'production' || !loopback);

      if (
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        (secureUrl || localDevelopmentUrl)
      ) {
        url.pathname = '/';
        return url.toString().replace(/\/$/, '');
      }
    } catch {
      // Fail closed below instead of emitting an untrusted or obsolete URL.
    }
  }

  return nodeEnv === 'production' ? null : LOCAL_ADMIN_URL;
}

export const ADMIN_DASHBOARD_URL = adminPublicUrl({
  nodeEnv: process.env.NODE_ENV,
  adminPublicUrl: process.env.ADMIN_PUBLIC_URL,
});
