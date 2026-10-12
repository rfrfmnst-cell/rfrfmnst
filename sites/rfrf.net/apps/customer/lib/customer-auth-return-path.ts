const RETURN_ORIGIN = 'https://rfrf.net';
const RETURN_PATHS = new Set(['/chat', '/account', '/account/settings']);

/** Only existing customer destinations can be resumed after authentication. */
export function safePostAuthPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 2_048 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    [...value].some((character) => character.charCodeAt(0) <= 32)
  ) {
    return '/chat';
  }
  try {
    const url = new URL(value, RETURN_ORIGIN);
    const rawPath = value.split(/[?#]/, 1)[0];
    if (
      url.origin !== RETURN_ORIGIN ||
      url.pathname !== rawPath ||
      !RETURN_PATHS.has(url.pathname)
    ) {
      return '/chat';
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/chat';
  }
}

export function withCustomerAuthReturnPath(
  path: string,
  next?: unknown,
): string {
  if (next === undefined || next === null || next === '') return path;
  const url = new URL(path, RETURN_ORIGIN);
  url.searchParams.set('next', safePostAuthPath(next));
  return `${url.pathname}${url.search}`;
}

export const CUSTOMER_AUTH_RETURN_COOKIE = 'cu_auth_next';
export const customerAuthReturnCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 15 * 60,
};
