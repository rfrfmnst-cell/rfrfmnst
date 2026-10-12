export interface PaymentUrlEnvironment {
  NODE_ENV?: string;
  CUSTOMER_PUBLIC_URL?: string;
  VERCEL_URL?: string;
  EDFAPAY_CHECKOUT_ORIGINS?: string;
}

const EDFAPAY_CHECKOUT_ORIGINS = new Set([
  'https://app.edfapay.com',
  'https://demo.edfapay.com',
]);
const EDFAPAY_CHECKOUT_ORIGIN_BY_ENVIRONMENT = {
  live: 'https://app.edfapay.com',
  sandbox: 'https://demo.edfapay.com',
} as const;

function normalizedOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    if (
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && url.hostname === 'localhost')
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/** Callback URLs come from trusted server configuration, never request headers. */
export function customerPaymentOrigin(
  env: PaymentUrlEnvironment,
): string | null {
  const configured = normalizedOrigin(env.CUSTOMER_PUBLIC_URL);
  if (
    configured &&
    (env.NODE_ENV !== 'production' || configured.startsWith('https://'))
  ) {
    return configured;
  }
  const vercel = normalizedOrigin(env.VERCEL_URL);
  if (
    vercel &&
    (env.NODE_ENV !== 'production' || vercel.startsWith('https://'))
  ) {
    return vercel;
  }
  return env.NODE_ENV === 'production' ? null : 'http://localhost:3001';
}

/** The hosted checkout may redirect only to an explicitly approved HTTPS origin. */
export function isAllowedCheckoutRedirect(
  value: string,
  env: PaymentUrlEnvironment,
): boolean {
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    return false;
  }
  if (target.protocol !== 'https:' || target.username || target.password) {
    return false;
  }

  const allowed = (env.EDFAPAY_CHECKOUT_ORIGINS ?? '')
    .split(',')
    .map((origin) => normalizedOrigin(origin))
    .filter(
      (origin): origin is string =>
        origin !== null && EDFAPAY_CHECKOUT_ORIGINS.has(origin),
    );
  return allowed.includes(target.origin);
}

/** The API endpoint and hosted page must belong to the same money environment. */
export function hasEdfaPayCheckoutRedirectOrigin(
  env: PaymentUrlEnvironment,
  environment: keyof typeof EDFAPAY_CHECKOUT_ORIGIN_BY_ENVIRONMENT,
): boolean {
  const expected = EDFAPAY_CHECKOUT_ORIGIN_BY_ENVIRONMENT[environment];
  return (env.EDFAPAY_CHECKOUT_ORIGINS ?? '')
    .split(',')
    .map((origin) => normalizedOrigin(origin))
    .some((origin) => origin === expected);
}
