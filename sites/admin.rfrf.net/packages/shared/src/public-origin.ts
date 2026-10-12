/**
 * The exact public origin a surface must use when it builds a redirect.
 *
 * Next builds `request.url` from the bound `HOSTNAME`/`PORT` in standalone
 * output, so behind a reverse proxy `new URL(path, request.url)` emits the
 * container address in `Location` — `https://0.0.0.0:3000/login` — which no
 * browser can follow. The forwarded host does not change this; the value never
 * came from the request headers. Each surface therefore binds its own
 * canonical origin (`CUSTOMER_PUBLIC_URL`, `ADMIN_PUBLIC_URL`,
 * `NEXT_PUBLIC_SUPPLIER_APP_URL`) and only falls back to the request when none
 * is configured, which keeps local development and single-origin hosting
 * working unchanged.
 */
export function exactPublicOrigin(
  value: string | undefined,
  production: boolean,
): string | null {
  try {
    const url = new URL(value ?? '');
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '/' && url.pathname !== '') ||
      (production && url.protocol !== 'https:') ||
      (!production &&
        url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' &&
          (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
        ))
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function exactHttpRequestOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '/' && url.pathname !== '') ||
      (url.protocol !== 'https:' && url.protocol !== 'http:')
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Base for a same-origin redirect. A configured origin always wins; an absent
 * or malformed one degrades to the request so a misconfiguration cannot make
 * the surface unreachable.
 */
export function redirectOrigin(
  configured: string | undefined,
  requestUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    exactPublicOrigin(configured, env.NODE_ENV === 'production') ??
    new URL(requestUrl).origin
  );
}

/**
 * Validate a browser mutation against a surface's canonical public origin.
 *
 * Standalone Next servers see their container origin in `request.url`, so a
 * production browser Origin must be compared with the configured public URL.
 * Development keeps the request-origin fallback for local servers. Requests
 * without an Origin preserve the existing non-browser client contract.
 */
export function requestOriginAllowed(
  requestOrigin: string | null,
  configured: string | undefined,
  requestUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!requestOrigin) return true;

  const production = env.NODE_ENV === 'production';
  const configuredOrigin = exactPublicOrigin(configured, production);
  if (configuredOrigin) {
    return exactPublicOrigin(requestOrigin, production) === configuredOrigin;
  }
  if (production) return false;

  try {
    const request = new URL(requestUrl);
    if (request.protocol !== 'https:' && request.protocol !== 'http:') {
      return false;
    }
    return exactHttpRequestOrigin(requestOrigin) === request.origin;
  } catch {
    return false;
  }
}
