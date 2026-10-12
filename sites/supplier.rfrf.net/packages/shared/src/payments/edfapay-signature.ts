import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const EDFAPAY_WEBHOOK_SIGNATURE_HEADER = 'x-edfapay-signature';
export const EDFAPAY_WEBHOOK_CONTRACT_VERSION = 'hmac-sha256-rawbody-hex-v1';

/**
 * EdfaPay's versioned webhook contract: HMAC-SHA256 over the exact raw body,
 * returned as a hex digest in X-EdfaPay-Signature. Launch readiness separately
 * requires recent endpoint-, environment-, and secret-bound evidence from a
 * real signed callback.
 */
export function signEdfaPayWebhook(
  rawBody: string | Uint8Array,
  secret: string,
): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** Rotation-safe identifier; never stores or returns the webhook secret. */
export function edfaPayWebhookSecretVersion(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 16);
}

export function verifyEdfaPayWebhookSignature(input: {
  rawBody: string | Uint8Array;
  secret: string;
  signature: unknown;
}): boolean {
  if (
    typeof input.signature !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(input.signature)
  ) {
    return false;
  }
  const expected = Buffer.from(
    signEdfaPayWebhook(input.rawBody, input.secret),
    'hex',
  );
  const received = Buffer.from(input.signature, 'hex');
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

export function edfaPayWebhookSecretFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const secret = env.EDFAPAY_WEBHOOK_SECRET;
  return secret && secret.trim().length >= 32 ? secret : null;
}
