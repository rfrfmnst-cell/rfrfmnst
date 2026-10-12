export interface SupplierRegistrationEnvironment {
  nodeEnv?: string;
  supplierAppUrl?: string;
}

const LOCAL_SUPPLIER_REGISTRATION_URL = 'http://localhost:3002/?register=1';
const PRODUCTION_SUPPLIER_REGISTRATION_URL =
  'https://supplier.rfrf.net/?register=1';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function supplierRegistrationUrl({
  nodeEnv,
  supplierAppUrl,
}: SupplierRegistrationEnvironment): string {
  const configured = supplierAppUrl?.trim();

  if (configured) {
    try {
      const url = new URL(configured);
      const localDevelopmentUrl =
        nodeEnv !== 'production' &&
        url.protocol === 'http:' &&
        LOCAL_HOSTS.has(url.hostname);

      if (
        !url.username &&
        !url.password &&
        !url.hash &&
        (url.protocol === 'https:' || localDevelopmentUrl)
      ) {
        url.pathname = '/';
        url.search = '?register=1';
        return url.toString();
      }
    } catch {
      // Fall through to the environment-safe default.
    }
  }

  return nodeEnv === 'production'
    ? PRODUCTION_SUPPLIER_REGISTRATION_URL
    : LOCAL_SUPPLIER_REGISTRATION_URL;
}

export const SUPPLIER_REGISTRATION_URL = supplierRegistrationUrl({
  nodeEnv: process.env.NODE_ENV,
  supplierAppUrl: process.env.NEXT_PUBLIC_SUPPLIER_APP_URL,
});
