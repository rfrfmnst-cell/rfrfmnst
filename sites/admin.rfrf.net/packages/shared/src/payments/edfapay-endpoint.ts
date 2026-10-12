/**
 * Hosted Checkout v1 endpoints from EdfaPay's current API reference.
 *
 * Keep these as exact origins. Requests contain customer contact and signed-in
 * order data, so an operator-provided arbitrary HTTPS URL is not acceptable.
 */
export const EDFAPAY_LIVE_API_ORIGIN = 'https://app-api.edfapay.com';
export const EDFAPAY_SANDBOX_API_ORIGIN = 'https://demo-api.edfapay.com';

const ALLOWED_API_ORIGINS = new Set([
  EDFAPAY_LIVE_API_ORIGIN,
  EDFAPAY_SANDBOX_API_ORIGIN,
]);

export type EdfaPayApiEnvironment = 'live' | 'sandbox';

/**
 * Normalize only EdfaPay-owned API origins.
 *
 * Provider requests carry signed order/customer data, so a merely valid HTTPS
 * URL is not enough: accepting arbitrary hosts would turn a configuration typo
 * into an SSRF/data-exfiltration path.
 */
export function normalizeEdfaPayApiBaseUrl(
  value: string | undefined,
): string | null {
  // Money-moving adapters must never infer production from a missing value.
  // Every deployment chooses sandbox or live explicitly.
  const raw = value?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '') ||
    !ALLOWED_API_ORIGINS.has(url.origin)
  ) {
    return null;
  }
  return url.origin;
}

export function edfaPayApiEnvironment(
  value: string | undefined,
): EdfaPayApiEnvironment | null {
  const origin = normalizeEdfaPayApiBaseUrl(value);
  if (origin === EDFAPAY_LIVE_API_ORIGIN) return 'live';
  if (origin === EDFAPAY_SANDBOX_API_ORIGIN) return 'sandbox';
  return null;
}
