import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  normalizeCustomerEmail,
  normalizeCustomerName,
} from './customer-password.ts';

const VERSION = 1;
const TTL_SECONDS = 10 * 60;

export const CUSTOMER_REGISTRATION_COOKIE = 'cu_registration';

type RegistrationProofInput =
  | { provider: 'phone'; phone: string }
  | {
      provider: 'google';
      googleSubject: string;
      email: string;
      suggestedName: string;
    };

export type CustomerRegistrationProof =
  | {
      version: 1;
      provider: 'phone';
      phone: string;
      issuedAt: number;
      expiresAt: number;
    }
  | {
      version: 1;
      provider: 'google';
      googleSubject: string;
      email: string;
      suggestedName: string;
      issuedAt: number;
      expiresAt: number;
    };

function secret(): string {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV !== 'production') {
    return developmentSecret;
  }
  throw new Error('SESSION_SECRET_CONFIGURATION');
}

const developmentSecret = randomBytes(32).toString('base64url');

function signature(payload: string): string {
  return createHmac('sha256', secret())
    .update(`customer-registration:${payload}`)
    .digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export function createCustomerRegistrationProof(
  input: RegistrationProofInput,
  nowMs = Date.now(),
): string {
  const issuedAt = Math.floor(nowMs / 1000);
  const proof: CustomerRegistrationProof = {
    version: VERSION,
    ...input,
    issuedAt,
    expiresAt: issuedAt + TTL_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(proof)).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function parseCustomerRegistrationProof(
  value: string | undefined,
  nowMs = Date.now(),
): CustomerRegistrationProof | null {
  if (!value || value.length > 2_048) return null;
  const [payload, suppliedSignature, ...extra] = value.split('.');
  if (!payload || !suppliedSignature || extra.length > 0) return null;
  if (!safeEqual(suppliedSignature, signature(payload))) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as Partial<CustomerRegistrationProof>;
    const now = Math.floor(nowMs / 1000);
    if (
      parsed.version !== VERSION ||
      !Number.isSafeInteger(parsed.issuedAt) ||
      !Number.isSafeInteger(parsed.expiresAt) ||
      parsed.issuedAt! > now + 60 ||
      parsed.expiresAt! <= now ||
      parsed.expiresAt! - parsed.issuedAt! !== TTL_SECONDS
    ) {
      return null;
    }
    if (
      parsed.provider === 'phone' &&
      typeof parsed.phone === 'string' &&
      /^\+9665\d{8}$/.test(parsed.phone)
    ) {
      return parsed as Extract<
        CustomerRegistrationProof,
        { provider: 'phone' }
      >;
    }
    if (
      parsed.provider === 'google' &&
      typeof parsed.googleSubject === 'string' &&
      /^\d{6,255}$/.test(parsed.googleSubject) &&
      typeof parsed.email === 'string' &&
      normalizeCustomerEmail(parsed.email) === parsed.email &&
      typeof parsed.suggestedName === 'string' &&
      normalizeCustomerName(parsed.suggestedName) === parsed.suggestedName
    ) {
      return parsed as Extract<
        CustomerRegistrationProof,
        { provider: 'google' }
      >;
    }
    return null;
  } catch {
    return null;
  }
}

export const customerRegistrationCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/login',
  maxAge: TTL_SECONDS,
};
