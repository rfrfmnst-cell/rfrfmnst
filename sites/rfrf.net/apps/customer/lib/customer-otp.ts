import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

export const CUSTOMER_OTP_COOKIE = 'cu_otp_challenge';
export const CUSTOMER_OTP_TTL_SECONDS = 5 * 60;
export const MAX_OTP_ATTEMPTS = 5;

const DEVELOPMENT_SECRET = randomBytes(32).toString('base64url');
const VERSION = 1;

export interface CustomerOtpChallenge {
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

function signedCookie(challenge: CustomerOtpChallenge): string {
  const secret = securitySecret();
  if (!secret) {
    throw new Error(
      'SESSION_SECRET must be configured with at least 32 characters in production',
    );
  }

  const payload = Buffer.from(JSON.stringify(challenge)).toString('base64url');
  return `${payload}.${hmac(`customer-otp-cookie:${payload}`, secret)}`;
}

export function createCustomerOtpChallenge(phone: string): {
  code: string;
  cookie: string;
  expiresAt: number;
} {
  const secret = securitySecret();
  if (!secret) {
    throw new Error(
      'SESSION_SECRET must be configured with at least 32 characters in production',
    );
  }

  const code = String(randomInt(100000, 1000000));
  const nonce = randomBytes(16).toString('base64url');
  const expiresAt = Date.now() + CUSTOMER_OTP_TTL_SECONDS * 1000;
  const challenge: CustomerOtpChallenge = {
    version: VERSION,
    phone,
    expiresAt,
    attempts: 0,
    nonce,
    codeDigest: hmac(`customer-otp-code:${phone}:${nonce}:${code}`, secret),
  };

  return { code, cookie: signedCookie(challenge), expiresAt };
}

export function parseCustomerOtpChallenge(
  value: string | undefined,
): CustomerOtpChallenge | null {
  if (!value) return null;
  const secret = securitySecret();
  if (!secret) return null;

  const [payload, signature, ...rest] = value.split('.');
  if (!payload || !signature || rest.length > 0) return null;
  const expectedSignature = hmac(`customer-otp-cookie:${payload}`, secret);
  if (!safeEqual(signature, expectedSignature)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as Partial<CustomerOtpChallenge>;

    if (
      parsed.version !== VERSION ||
      typeof parsed.phone !== 'string' ||
      !/^\+9665\d{8}$/.test(parsed.phone) ||
      typeof parsed.expiresAt !== 'number' ||
      !Number.isSafeInteger(parsed.expiresAt) ||
      parsed.expiresAt <= Date.now() ||
      typeof parsed.attempts !== 'number' ||
      !Number.isInteger(parsed.attempts) ||
      parsed.attempts < 0 ||
      parsed.attempts > MAX_OTP_ATTEMPTS ||
      typeof parsed.nonce !== 'string' ||
      !/^[A-Za-z0-9_-]{20,32}$/.test(parsed.nonce) ||
      typeof parsed.codeDigest !== 'string' ||
      !/^[A-Za-z0-9_-]{40,48}$/.test(parsed.codeDigest)
    ) {
      return null;
    }

    return parsed as CustomerOtpChallenge;
  } catch {
    return null;
  }
}

export function verifyCustomerOtpCode(
  challenge: CustomerOtpChallenge,
  code: string,
): boolean {
  const secret = securitySecret();
  if (!secret || !/^\d{6}$/.test(code)) return false;

  const expected = hmac(
    `customer-otp-code:${challenge.phone}:${challenge.nonce}:${code}`,
    secret,
  );
  return safeEqual(challenge.codeDigest, expected);
}

export function incrementCustomerOtpAttempts(
  challenge: CustomerOtpChallenge,
  attempts = challenge.attempts + 1,
): string {
  return signedCookie({
    ...challenge,
    attempts: Math.min(MAX_OTP_ATTEMPTS, Math.max(0, Math.trunc(attempts))),
  });
}

export function customerOtpSubjectKey(
  kind: 'phone' | 'ip',
  value: string,
): string {
  const secret = securitySecret();
  if (!secret) {
    throw new Error(
      'SESSION_SECRET must be configured with at least 32 characters in production',
    );
  }
  return `${kind}:${hmac(`customer-otp-rate:${kind}:${value}`, secret)}`;
}

export function customerOtpChallengeKey(nonce: string): string {
  const secret = securitySecret();
  if (!secret) {
    throw new Error(
      'SESSION_SECRET must be configured with at least 32 characters in production',
    );
  }
  return `challenge:${hmac(`customer-otp-challenge:${nonce}`, secret)}`;
}

export function maskCustomerPhone(phone: string): string {
  return `${phone.slice(0, 7)}•••${phone.slice(-2)}`;
}
