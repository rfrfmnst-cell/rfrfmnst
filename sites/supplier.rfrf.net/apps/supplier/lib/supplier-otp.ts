import { normalizeOtpCode } from './auth-input.ts';
import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { isCanonicalSupplierPhone } from './supplier-phone.ts';

export const SUPPLIER_OTP_COOKIE = 'sp_otp_challenge';
export const SUPPLIER_OTP_TTL_SECONDS = 5 * 60;
export const MAX_SUPPLIER_OTP_ATTEMPTS = 5;

const DEVELOPMENT_SECRET = randomBytes(32).toString('base64url');
const VERSION = 1;

export interface SupplierOtpChallenge {
  version: 1;
  phone: string;
  expiresAt: number;
  attempts: number;
  nonce: string;
  codeDigest: string;
}

function securitySecret(): string | null {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV !== 'production') return DEVELOPMENT_SECRET;
  return null;
}

function hmac(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function signedCookie(challenge: SupplierOtpChallenge): string {
  const secret = securitySecret();
  if (!secret) {
    throw new Error(
      'SESSION_SECRET must be configured with at least 32 characters in production',
    );
  }

  const payload = Buffer.from(JSON.stringify(challenge)).toString('base64url');
  return `${payload}.${hmac(`supplier-otp-cookie:${payload}`, secret)}`;
}

export function createSupplierOtpChallenge(phone: string): {
  code: string;
  cookie: string;
} {
  const secret = securitySecret();
  if (!secret) {
    throw new Error(
      'SESSION_SECRET must be configured with at least 32 characters in production',
    );
  }

  const code = String(randomInt(100000, 1000000));
  const nonce = randomBytes(16).toString('base64url');
  const challenge: SupplierOtpChallenge = {
    version: VERSION,
    phone,
    expiresAt: Date.now() + SUPPLIER_OTP_TTL_SECONDS * 1000,
    attempts: 0,
    nonce,
    codeDigest: hmac(`supplier-otp-code:${phone}:${nonce}:${code}`, secret),
  };
  return { code, cookie: signedCookie(challenge) };
}

export function parseSupplierOtpChallenge(
  value: string | undefined,
): SupplierOtpChallenge | null {
  if (!value) return null;
  const secret = securitySecret();
  if (!secret) return null;

  const [payload, signature, ...rest] = value.split('.');
  if (!payload || !signature || rest.length > 0) return null;
  const expectedSignature = hmac(`supplier-otp-cookie:${payload}`, secret);
  if (!safeEqual(signature, expectedSignature)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as Partial<SupplierOtpChallenge>;
    if (
      parsed.version !== VERSION ||
      !isCanonicalSupplierPhone(parsed.phone) ||
      typeof parsed.expiresAt !== 'number' ||
      !Number.isSafeInteger(parsed.expiresAt) ||
      parsed.expiresAt <= Date.now() ||
      typeof parsed.attempts !== 'number' ||
      !Number.isInteger(parsed.attempts) ||
      parsed.attempts < 0 ||
      parsed.attempts > MAX_SUPPLIER_OTP_ATTEMPTS ||
      typeof parsed.nonce !== 'string' ||
      !/^[A-Za-z0-9_-]{20,32}$/.test(parsed.nonce) ||
      typeof parsed.codeDigest !== 'string' ||
      !/^[A-Za-z0-9_-]{40,48}$/.test(parsed.codeDigest)
    ) {
      return null;
    }
    return parsed as SupplierOtpChallenge;
  } catch {
    return null;
  }
}

export function verifySupplierOtpCode(
  challenge: SupplierOtpChallenge,
  code: string,
): boolean {
  const secret = securitySecret();
  code = normalizeOtpCode(code);
  if (!secret || !/^\d{6}$/.test(code)) return false;
  const expected = hmac(
    `supplier-otp-code:${challenge.phone}:${challenge.nonce}:${code}`,
    secret,
  );
  return safeEqual(challenge.codeDigest, expected);
}

export function setSupplierOtpAttempts(
  challenge: SupplierOtpChallenge,
  attempts: number,
): string {
  return signedCookie({
    ...challenge,
    attempts: Math.min(
      MAX_SUPPLIER_OTP_ATTEMPTS,
      Math.max(0, Math.trunc(attempts)),
    ),
  });
}

function opaqueKey(scope: string, value: string): string {
  const secret = securitySecret();
  if (!secret) {
    throw new Error(
      'SESSION_SECRET must be configured with at least 32 characters in production',
    );
  }
  return `${scope}:${hmac(`supplier-otp-${scope}:${value}`, secret)}`;
}

export function supplierOtpSubjectKey(
  kind: 'phone' | 'ip',
  value: string,
): string {
  return opaqueKey(kind, value);
}

export function supplierOtpChallengeKey(nonce: string): string {
  return opaqueKey('challenge', nonce);
}

export function maskSupplierPhone(phone: string): string {
  return `${phone.slice(0, 7)}•••${phone.slice(-2)}`;
}
