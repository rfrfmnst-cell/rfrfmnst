export type CustomerProxyDecision = 'allow' | 'redirect-login' | 'unauthorized';

type CustomerProxyContext = {
  pathname: string;
  authenticated: boolean;
  wantsHtml: boolean;
};

export function chatAuthRecoveryPath(error: unknown): string | null {
  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    error.status === 401
  ) {
    return '/login?next=/chat';
  }

  const message = error instanceof Error ? error.message : String(error ?? '');
  return /(?:\b401\b|unauthorized|مطلوب تسجيل الدخول)/i.test(message)
    ? '/login?next=/chat'
    : null;
}

function isProtectedCustomerPath(pathname: string): boolean {
  return pathname === '/account' || pathname === '/account/settings';
}

export function customerLoginRedirectPath(
  pathname: string,
  search: string | Record<string, string | string[] | undefined> = '',
): string {
  const query = new URLSearchParams();
  if (typeof search !== 'string') {
    for (const [key, values] of Object.entries(search)) {
      for (const value of Array.isArray(values)
        ? values
        : values === undefined
          ? []
          : [values]) {
        query.append(key, value);
      }
    }
  }
  const suffix =
    typeof search === 'string' ? search : query.size ? `?${query}` : '';
  const params = new URLSearchParams({ next: `${pathname}${suffix}` });
  return isProtectedCustomerPath(pathname) ? `/login?${params}` : '/login';
}

export function decideCustomerProxyRoute({
  pathname,
  authenticated,
  wantsHtml,
}: CustomerProxyContext): CustomerProxyDecision {
  if (!isProtectedCustomerPath(pathname) || authenticated) return 'allow';
  return wantsHtml ? 'redirect-login' : 'unauthorized';
}
