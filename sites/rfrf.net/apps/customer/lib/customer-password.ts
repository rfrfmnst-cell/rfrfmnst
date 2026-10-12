import { domainToASCII } from 'node:url';
import {
  createHmac,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from 'node:crypto';
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

export const DUMMY_CUSTOMER_PASSWORD_HASH =
  'scrypt$32768$8$1$Y3VzdG9tZXItYXV0aC1kdQ$kER7K5aH7ZcdMhqAJ4-XuG8z6_OFX909S--svY2VXI9AaekmQopDQ1aQq9azUX39mRtj-a87CCq8ClXyoOD7KA';

function deriveScrypt(password: string, salt: Buffer, length: number) {
  return new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(
      password,
      salt,
      length,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, derived) => (error ? reject(error) : resolve(derived)),
    );
  });
}

function decodeBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.toString('base64url') === value ? decoded : null;
  } catch {
    return null;
  }
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

export function normalizeCustomerEmail(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim().normalize('NFKC') : '';
  if (
    !raw ||
    raw.length > 254 ||
    hasControlCharacters(raw) ||
    /\s/u.test(raw)
  ) {
    return null;
  }
  const at = raw.lastIndexOf('@');
  if (at < 1 || at !== raw.indexOf('@')) return null;
  const local = raw.slice(0, at).toLowerCase();
  const asciiDomain = domainToASCII(raw.slice(at + 1).toLowerCase());
  if (
    local.length > 64 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..') ||
    !/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
      asciiDomain,
    )
  ) {
    return null;
  }
  return `${local}@${asciiDomain}`;
}

export function normalizeCustomerName(value: unknown): string | null {
  const normalized =
    typeof value === 'string'
      ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
      : '';
  if (
    normalized.length < 2 ||
    normalized.length > 100 ||
    hasControlCharacters(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function validateCustomerPassword(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) {
    return false;
  }
  return /\p{L}/u.test(value) && /\p{N}/u.test(value);
}

export function customerCredentialSubjectKey(email: string): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET_CONFIGURATION');
  }
  return `email:${createHmac('sha256', secret)
    .update(`customer-credential:${email}`)
    .digest('base64url')}`;
}

export async function hashCustomerPassword(password: string): Promise<string> {
  if (!validateCustomerPassword(password)) {
    throw new Error('CUSTOMER_PASSWORD_POLICY');
  }
  const salt = randomBytes(16);
  const digest = await deriveScrypt(password, salt, SCRYPT_KEY_LENGTH);
  return [
    'scrypt',
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64url'),
    digest.toString('base64url'),
  ].join('$');
}

export async function verifyCustomerPassword(
  password: string,
  encodedHash: string | null | undefined,
): Promise<boolean> {
  const parts = encodedHash?.split('$') ?? [];
  const [algorithm, nRaw, rRaw, pRaw, saltRaw, expectedRaw] = parts;
  if (
    parts.length !== 6 ||
    algorithm !== 'scrypt' ||
    nRaw !== String(SCRYPT_N) ||
    rRaw !== String(SCRYPT_R) ||
    pRaw !== String(SCRYPT_P)
  ) {
    return false;
  }
  const salt = saltRaw ? decodeBase64Url(saltRaw) : null;
  const expected = expectedRaw ? decodeBase64Url(expectedRaw) : null;
  if (!salt || salt.length !== 16 || !expected || expected.length !== 64) {
    return false;
  }
  try {
    const derived = await deriveScrypt(password, salt, expected.length);
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
