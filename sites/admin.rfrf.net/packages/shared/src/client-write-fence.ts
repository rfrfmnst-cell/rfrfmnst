import { timingSafeEqual } from 'node:crypto';

type FenceRequest = {
  method: string;
  nextUrl: { pathname: string };
  headers?: { get(name: string): string | null };
};

export const CLIENT_QA_HEADER = 'x-rafraf-client-qa-key';
const QA_KEY_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

function customerQaAuthorized(
  request: FenceRequest,
  expectedKey: string | undefined,
): boolean {
  const { method, nextUrl } = request;
  const allowed =
    (method === 'POST' && nextUrl.pathname === '/api/chat') ||
    ((method === 'GET' || method === 'POST') &&
      nextUrl.pathname === '/api/chat/threads') ||
    (method === 'GET' &&
      /^\/api\/chat\/threads\/c[a-z0-9]{24}$/.test(nextUrl.pathname));
  if (!allowed || !expectedKey || !QA_KEY_PATTERN.test(expectedKey))
    return false;
  const supplied = request.headers?.get(CLIENT_QA_HEADER);
  if (
    !supplied ||
    !QA_KEY_PATTERN.test(supplied) ||
    supplied.length !== expectedKey.length
  ) {
    return false;
  }
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expectedKey));
}

/** Preserve the static exclusions previously enforced by the Next proxy matcher. */
export function isProxyStaticPath(pathname: string): boolean {
  return (
    /^\/(?:_next\/static|_next\/image|favicon.ico)/.test(pathname) ||
    /\.(?:png|jpg|jpeg|webp|svg|woff2?|ttf|otf)$/.test(pathname)
  );
}

/**
 * Brief migration fence: GET callbacks can write, so only read-only health
 * routes and explicitly keyed customer QA pass. Evaluate before sessions.
 */
export function clientWriteFenceResponse(
  request: FenceRequest,
  enabled: string | undefined,
  customerQaKey?: string,
): Response | null {
  if (enabled !== 'true') return null;
  if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    (request.nextUrl.pathname === '/api/liveness' ||
      request.nextUrl.pathname === '/api/readiness')
  ) {
    return null;
  }
  // Only the customer proxy passes this separate key. Route session and
  // database ownership checks still run; the key grants no user identity.
  if (customerQaAuthorized(request, customerQaKey)) return null;

  return new Response(
    request.method === 'HEAD'
      ? null
      : 'المنصة قيد نقل البيانات. حاول مرة أخرى بعد قليل.',
    {
      status: 503,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Content-Type': 'text/plain; charset=utf-8',
        'Retry-After': '30',
      },
    },
  );
}
