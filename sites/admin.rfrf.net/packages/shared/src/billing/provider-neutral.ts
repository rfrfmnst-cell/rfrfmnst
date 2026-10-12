import { resolveVatRate } from '../pricing/vat';

export const RAFRAF_BILLING_DOCUMENT_VERSION = 'rafraf-billing-v1';

export interface ProviderNeutralBillingConfiguration {
  mode: 'provider_neutral';
  issuerName: string;
  issuerId: string;
  documentVersion: typeof RAFRAF_BILLING_DOCUMENT_VERSION;
  vatRate: number;
}

const SAFE_ISSUER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/u;

export function providerNeutralBillingConfiguration(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): ProviderNeutralBillingConfiguration | null {
  const issuerName = env.BILLING_ISSUER_NAME?.replace(/\s+/gu, ' ').trim();
  const issuerId = env.BILLING_ISSUER_ID?.trim();
  if (
    env.BILLING_MODE?.trim().toLowerCase() !== 'provider_neutral' ||
    !issuerName ||
    issuerName.length > 160 ||
    !issuerId ||
    !SAFE_ISSUER_ID.test(issuerId) ||
    env.BILLING_DOCUMENT_VERSION?.trim() !== RAFRAF_BILLING_DOCUMENT_VERSION
  ) {
    return null;
  }

  try {
    return {
      mode: 'provider_neutral',
      issuerName,
      issuerId,
      documentVersion: RAFRAF_BILLING_DOCUMENT_VERSION,
      vatRate: resolveVatRate(env.VAT_RATE),
    };
  } catch {
    return null;
  }
}

export function includedTaxAmount(total: number, vatRate: number): number {
  if (!Number.isFinite(total) || total < 0)
    throw new Error('Billing total must be a non-negative finite number');
  if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 1)
    throw new Error('Billing VAT rate is invalid');
  const tax = vatRate === 0 ? 0 : total - total / (1 + vatRate);
  return Math.round((tax + Number.EPSILON) * 100) / 100;
}
