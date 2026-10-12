import { ActorType, type Prisma, prisma } from '@rafraf/db';
import { edfaPayApiEnvironment } from '@rafraf/shared/payments/edfapay-endpoint';
import {
  EDFAPAY_WEBHOOK_CONTRACT_VERSION,
  edfaPayWebhookSecretFromEnv,
  edfaPayWebhookSecretVersion,
} from '@rafraf/shared/payments/edfapay-signature';
import { customerPaymentOrigin } from '@rafraf/shared/payments/payment-url-policy';
import type { EdfaPayWebhookEvidence } from '@rafraf/shared/payments/edfapay-readiness';

export const EDFAPAY_WEBHOOK_EVIDENCE_ACTION =
  'integration.edfapay.signed_webhook_verified';
const TRANSACTION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_ORDER_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function exactWebhookUrl(origin: string): string {
  return new URL('/api/payments/edfapay/webhook', `${origin}/`).toString();
}

function record(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readEdfaPayWebhookEvidence(input: {
  after: Prisma.JsonValue | null;
  createdAt: Date;
}): EdfaPayWebhookEvidence | null {
  const after = record(input.after);
  if (
    (after.environment !== 'sandbox' && after.environment !== 'live') ||
    typeof after.endpointUrl !== 'string' ||
    typeof after.transactionId !== 'string' ||
    typeof after.providerOrderCode !== 'string' ||
    typeof after.amount !== 'string' ||
    typeof after.currency !== 'string' ||
    typeof after.contractVersion !== 'string' ||
    typeof after.secretVersion !== 'string' ||
    typeof after.release !== 'string'
  ) {
    return null;
  }
  return {
    environment: after.environment,
    endpointUrl: after.endpointUrl,
    transactionId: after.transactionId,
    providerOrderCode: after.providerOrderCode,
    amount: after.amount,
    currency: after.currency,
    contractVersion: after.contractVersion,
    secretVersion: after.secretVersion,
    release: after.release,
    observedAt: input.createdAt.getTime(),
  };
}

/**
 * Persists evidence for a real callback after both raw-body signature
 * validation and authenticated provider status matching. The dedicated API
 * transaction probe remains separate, so a deploy can become ready naturally.
 */
export async function recordEdfaPayWebhookEvidence(
  input: {
    paymentId: string;
    requestUrl: string;
    transactionId: string;
    providerOrderCode: string;
    amount: string;
    currency: string;
  },
  client: typeof prisma = prisma,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const environment = edfaPayApiEnvironment(env.EDFAPAY_BASE_URL);
  const origin = customerPaymentOrigin(env);
  const secret = edfaPayWebhookSecretFromEnv(env);
  const release = env.VERCEL_GIT_COMMIT_SHA?.trim() ?? '';
  let observedEndpoint = '';
  try {
    const observed = new URL(input.requestUrl);
    observed.search = '';
    observed.hash = '';
    observedEndpoint = observed.toString();
  } catch {
    return false;
  }
  const expectedEndpoint = origin ? exactWebhookUrl(origin) : '';
  const secretVersion = secret ? edfaPayWebhookSecretVersion(secret) : '';
  if (
    !environment ||
    !origin ||
    !secret ||
    !/^[0-9a-f]{7,64}$/i.test(release) ||
    observedEndpoint !== expectedEndpoint ||
    !TRANSACTION_ID_PATTERN.test(input.transactionId) ||
    !PROVIDER_ORDER_CODE_PATTERN.test(input.providerOrderCode) ||
    !Number.isFinite(Number(input.amount)) ||
    Number(input.amount) <= 0 ||
    input.currency.toUpperCase() !== 'SAR'
  ) {
    return false;
  }

  try {
    return await client.$transaction(async (tx) => {
      const evidenceLock = [
        'edfapay-webhook-evidence',
        environment,
        observedEndpoint,
        secretVersion,
        input.transactionId.toLowerCase(),
      ].join(':');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${evidenceLock}))`;

      // A provider retry of the same callback must not refresh the 24-hour
      // readiness TTL. The original AuditLog.createdAt is the first receipt.
      const existing = await tx.auditLog.findFirst({
        where: {
          action: EDFAPAY_WEBHOOK_EVIDENCE_ACTION,
          entityType: 'payment',
          AND: [
            { after: { path: ['environment'], equals: environment } },
            { after: { path: ['endpointUrl'], equals: observedEndpoint } },
            {
              after: {
                path: ['transactionId'],
                equals: input.transactionId,
              },
            },
            { after: { path: ['secretVersion'], equals: secretVersion } },
          ],
        },
        select: { id: true },
      });
      if (existing) return true;

      await tx.auditLog.create({
        data: {
          actorType: ActorType.SYSTEM,
          action: EDFAPAY_WEBHOOK_EVIDENCE_ACTION,
          entityType: 'payment',
          entityId: input.paymentId,
          after: {
            environment,
            endpointUrl: observedEndpoint,
            transactionId: input.transactionId,
            providerOrderCode: input.providerOrderCode,
            amount: Number(input.amount).toFixed(2),
            currency: input.currency.toUpperCase(),
            contractVersion: EDFAPAY_WEBHOOK_CONTRACT_VERSION,
            secretVersion,
            release,
          },
        },
      });
      return true;
    });
  } catch {
    console.error('[payments:edfapay] webhook evidence write failed', {
      code: 'WEBHOOK_EVIDENCE_WRITE_FAILED',
    });
    return false;
  }
}
