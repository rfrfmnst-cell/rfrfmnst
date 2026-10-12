import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  otoWebhookConfigFromEnv,
  type OtoWebhookConfig,
} from './oto-config.ts';

const MAX_WEBHOOK_BYTES = 64 * 1024;
const SAFE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._~:/-]{0,199}$/u;

export type OtoWebhookEvent =
  | {
      kind: 'ORDER_STATUS';
      eventId: string;
      orderId: string;
      status: string;
      timestamp: string;
      trackingNumber: string | null;
      labelUrl: string | null;
      payload: Record<string, unknown>;
    }
  | {
      kind: 'SHIPMENT_ERROR';
      eventId: string;
      orderId: string;
      errorCode: string;
      timestamp: string;
      trackingNumber: null;
      labelUrl: null;
      payload: Record<string, unknown>;
    };

export class OtoWebhookVerificationError extends Error {
  readonly code:
    | 'OTO_WEBHOOK_CONFIG_MISSING'
    | 'OTO_WEBHOOK_BODY_INVALID'
    | 'OTO_WEBHOOK_AUTH_INVALID'
    | 'OTO_WEBHOOK_SIGNATURE_INVALID';

  constructor(code: OtoWebhookVerificationError['code']) {
    super(code);
    this.name = 'OtoWebhookVerificationError';
    this.code = code;
  }
}

function safeValue(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return SAFE_VALUE.test(normalized) ? normalized : null;
}

function safeOptionalUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function exactSecretMatch(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function signatureMatches(
  signedValue: string,
  encodedSignature: string,
  secret: string,
): boolean {
  let actual: Buffer;
  try {
    actual = Buffer.from(encodedSignature, 'base64');
  } catch {
    return false;
  }
  const expected = createHmac('sha256', secret).update(signedValue).digest();
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function verifyOtoWebhook(
  rawBody: string,
  headers: Headers,
  config: OtoWebhookConfig,
): OtoWebhookEvent {
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_WEBHOOK_BYTES) {
    throw new OtoWebhookVerificationError('OTO_WEBHOOK_BODY_INVALID');
  }
  const authorization = headers.get('authorization') ?? '';
  if (!exactSecretMatch(authorization, config.authorizationKey)) {
    throw new OtoWebhookVerificationError('OTO_WEBHOOK_AUTH_INVALID');
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('invalid');
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    throw new OtoWebhookVerificationError('OTO_WEBHOOK_BODY_INVALID');
  }

  const orderId = safeValue(payload.orderId);
  const timestamp = safeValue(payload.timestamp);
  const signature =
    typeof payload.signature === 'string' ? payload.signature.trim() : '';
  const status = safeValue(payload.status);
  const errorCode = safeValue(payload.errorCode);
  if (!orderId || !timestamp || !signature || (!status && !errorCode)) {
    throw new OtoWebhookVerificationError('OTO_WEBHOOK_BODY_INVALID');
  }

  const eventValue = status ?? errorCode;
  const signedValue = `${orderId}:${eventValue}:${timestamp}`;
  if (!signatureMatches(signedValue, signature, config.signingSecret)) {
    throw new OtoWebhookVerificationError('OTO_WEBHOOK_SIGNATURE_INVALID');
  }
  const eventId = createHash('sha256')
    .update(`${signedValue}:${signature}`)
    .digest('hex');
  if (status) {
    return {
      kind: 'ORDER_STATUS',
      eventId,
      orderId,
      status,
      timestamp,
      trackingNumber: safeValue(payload.trackingNumber),
      labelUrl: safeOptionalUrl(payload.printAWBURL),
      payload,
    };
  }
  return {
    kind: 'SHIPMENT_ERROR',
    eventId,
    orderId,
    errorCode: errorCode as string,
    timestamp,
    trackingNumber: null,
    labelUrl: null,
    payload,
  };
}

export function verifyConfiguredOtoWebhook(
  rawBody: string,
  headers: Headers,
): OtoWebhookEvent {
  const config = otoWebhookConfigFromEnv(process.env);
  if (!config) {
    throw new OtoWebhookVerificationError('OTO_WEBHOOK_CONFIG_MISSING');
  }
  return verifyOtoWebhook(rawBody, headers, config);
}
