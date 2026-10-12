import {
  edfaPayApiEnvironment,
  type EdfaPayApiEnvironment,
} from './edfapay-endpoint';
import { edfaPayRefundProviderFromEnv } from './edfapay-refund-provider';
import {
  EDFAPAY_WEBHOOK_CONTRACT_VERSION,
  edfaPayWebhookSecretFromEnv,
  edfaPayWebhookSecretVersion,
} from './edfapay-signature';
import { customerPaymentOrigin } from './payment-url-policy';

const READINESS_TIMEOUT_MS = 2_500;
const WEBHOOK_EVIDENCE_TTL_MS = 24 * 60 * 60 * 1_000;
const CLOCK_SKEW_MS = 5 * 60 * 1_000;
const TRANSACTION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface EdfaPayReadinessResult {
  configured: boolean;
  apiVerified: boolean;
  webhookAttested: boolean;
  ready: boolean;
  reason: string | null;
}

export interface EdfaPayApiReadinessResult {
  configured: boolean;
  apiVerified: boolean;
  ready: boolean;
  environment: EdfaPayApiEnvironment | null;
  reason: string | null;
}

export interface EdfaPayWebhookEvidence {
  environment: EdfaPayApiEnvironment;
  endpointUrl: string;
  transactionId: string;
  providerOrderCode: string;
  amount: string;
  currency: string;
  contractVersion: string;
  secretVersion: string;
  release: string;
  observedAt: number;
}

function exactWebhookUrl(origin: string): string {
  return new URL('/api/payments/edfapay/webhook', `${origin}/`).toString();
}

function webhookEvidenceMatches(
  env: NodeJS.ProcessEnv,
  evidence: EdfaPayWebhookEvidence | null,
  input: {
    environment: EdfaPayApiEnvironment;
    webhookSecret: string;
  },
  now: number,
): boolean {
  const origin = customerPaymentOrigin(env);
  return Boolean(
    evidence &&
    origin &&
    evidence.environment === input.environment &&
    evidence.endpointUrl === exactWebhookUrl(origin) &&
    TRANSACTION_ID_PATTERN.test(evidence.transactionId) &&
    ORDER_ID_PATTERN.test(evidence.providerOrderCode) &&
    Number.isFinite(Number(evidence.amount)) &&
    Number(evidence.amount) > 0 &&
    evidence.currency === 'SAR' &&
    evidence.contractVersion === EDFAPAY_WEBHOOK_CONTRACT_VERSION &&
    evidence.secretVersion ===
      edfaPayWebhookSecretVersion(input.webhookSecret) &&
    Number.isFinite(evidence.observedAt) &&
    evidence.observedAt <= now + CLOCK_SKEW_MS &&
    now - evidence.observedAt <= WEBHOOK_EVIDENCE_TTL_MS,
  );
}

export function isEdfaPayWebhookEvidenceCurrent(
  env: NodeJS.ProcessEnv,
  evidence: EdfaPayWebhookEvidence | null,
  now = Date.now(),
): boolean {
  const environment = edfaPayApiEnvironment(env.EDFAPAY_BASE_URL);
  const webhookSecret = edfaPayWebhookSecretFromEnv(env);
  if (!environment || !webhookSecret) return false;
  return webhookEvidenceMatches(
    env,
    evidence,
    {
      environment,
      webhookSecret,
    },
    now,
  );
}

/** Read-only API identity probe shared by Customer checkout and Admin refunds. */
export async function edfaPayApiReadiness(
  env: NodeJS.ProcessEnv = process.env,
  expectedEnvironment?: EdfaPayApiEnvironment,
): Promise<EdfaPayApiReadinessResult> {
  const environment = edfaPayApiEnvironment(env.EDFAPAY_BASE_URL);
  const provider = edfaPayRefundProviderFromEnv(env, READINESS_TIMEOUT_MS);
  const configured = Boolean(
    environment &&
    provider &&
    (!expectedEnvironment || environment === expectedEnvironment),
  );
  if (!configured || !environment || !provider) {
    return {
      configured: false,
      apiVerified: false,
      ready: false,
      environment,
      reason: 'provider_configuration_missing',
    };
  }

  const transactionId = env.EDFAPAY_READINESS_TRANSACTION_ID?.trim() ?? '';
  const orderId = env.EDFAPAY_READINESS_ORDER_ID?.trim() ?? '';
  const amount = env.EDFAPAY_READINESS_AMOUNT?.trim() ?? '';
  const currency = env.EDFAPAY_READINESS_CURRENCY?.trim().toUpperCase() ?? '';
  const probeConfigured = Boolean(
    TRANSACTION_ID_PATTERN.test(transactionId) &&
    ORDER_ID_PATTERN.test(orderId) &&
    Number.isFinite(Number(amount)) &&
    Number(amount) > 0 &&
    currency === 'SAR',
  );
  if (!probeConfigured) {
    return {
      configured: true,
      apiVerified: false,
      ready: false,
      environment,
      reason: 'provider_probe_configuration_missing',
    };
  }

  try {
    await provider.status(orderId, transactionId, amount, currency);
    return {
      configured: true,
      apiVerified: true,
      ready: true,
      environment,
      reason: null,
    };
  } catch {
    return {
      configured: true,
      apiVerified: false,
      ready: false,
      environment,
      reason: 'provider_status_probe_failed',
    };
  }
}

/**
 * Read-only launch probe. Environment variables are never accepted as webhook
 * proof: evidence must have been persisted after a real signed callback and an
 * authenticated status match for the current secret version, callback endpoint
 * and provider environment. The release itself is verified independently by
 * every surface readiness response, so staged deployments can validate against
 * recent evidence captured on the stable callback URL before promotion.
 */
export async function edfaPayIntegrationReadiness(
  env: NodeJS.ProcessEnv = process.env,
  webhookEvidence: EdfaPayWebhookEvidence | null = null,
  now = Date.now(),
): Promise<EdfaPayReadinessResult> {
  const environment = edfaPayApiEnvironment(env.EDFAPAY_BASE_URL);
  const webhookSecret = edfaPayWebhookSecretFromEnv(env);
  const transactionId = env.EDFAPAY_READINESS_TRANSACTION_ID?.trim() ?? '';
  const orderId = env.EDFAPAY_READINESS_ORDER_ID?.trim() ?? '';
  const amount = env.EDFAPAY_READINESS_AMOUNT?.trim() ?? '';
  const currency = env.EDFAPAY_READINESS_CURRENCY?.trim().toUpperCase() ?? '';
  const provider = edfaPayRefundProviderFromEnv(env, READINESS_TIMEOUT_MS);
  const probeConfigured = Boolean(
    environment &&
    environment === env.PAYMENT_MODE?.trim().toLowerCase() &&
    webhookSecret &&
    provider &&
    TRANSACTION_ID_PATTERN.test(transactionId) &&
    ORDER_ID_PATTERN.test(orderId) &&
    Number.isFinite(Number(amount)) &&
    Number(amount) > 0 &&
    currency === 'SAR',
  );
  if (!probeConfigured || !environment || !webhookSecret || !provider) {
    return {
      configured: false,
      apiVerified: false,
      webhookAttested: false,
      ready: false,
      reason: 'provider_probe_configuration_missing',
    };
  }

  const webhookAttested = webhookEvidenceMatches(
    env,
    webhookEvidence,
    {
      environment,
      webhookSecret,
    },
    now,
  );
  const api = await edfaPayApiReadiness(env, environment);
  if (!api.ready) {
    return {
      configured: true,
      apiVerified: false,
      webhookAttested,
      ready: false,
      reason: api.reason ?? 'provider_status_probe_failed',
    };
  }
  if (!webhookAttested) {
    return {
      configured: true,
      apiVerified: true,
      webhookAttested: false,
      ready: false,
      reason: 'signed_webhook_evidence_missing_or_stale',
    };
  }
  return {
    configured: true,
    apiVerified: true,
    webhookAttested: true,
    ready: true,
    reason: null,
  };
}
