import { randomBytes } from 'node:crypto';

const DEVELOPMENT_SECRET = randomBytes(32).toString('base64url');
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const encoder = new TextEncoder();

function sessionSecret(): string | null {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV !== 'production') return DEVELOPMENT_SECRET;
  return null;
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function hmac(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`rafraf-supplier-session:${payload}`),
  );
  return toHex(signature);
}

export async function signSession(
  supplierId: string,
  nowMs = Date.now(),
): Promise<string> {
  const secret = sessionSecret();
  if (!secret) {
    throw new Error(
      'SESSION_SECRET must be configured with at least 32 characters in production',
    );
  }
  const issuedAt = Math.floor(nowMs / 1000);
  const expiresAt = issuedAt + SESSION_TTL_SECONDS;
  const payload = `${supplierId}.${issuedAt}.${expiresAt}`;
  return `v3.${payload}.${await hmac(payload, secret)}`;
}

export async function verifySession(
  token: string | undefined,
  nowMs = Date.now(),
): Promise<string | null> {
  if (!token) return null;
  const secret = sessionSecret();
  if (!secret) return null; // fail closed in production

  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== 'v3') return null;

  const [, supplierId, issuedRaw, expiresRaw, signature] = parts;
  if (!supplierId || !issuedRaw || !expiresRaw || !signature) return null;
  const issuedAt = Number(issuedRaw);
  const expiresAt = Number(expiresRaw);
  const now = Math.floor(nowMs / 1000);
  if (
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    issuedAt > now + 60 ||
    expiresAt <= now ||
    expiresAt - issuedAt !== SESSION_TTL_SECONDS
  ) {
    return null;
  }

  const payload = `${supplierId}.${issuedAt}.${expiresAt}`;
  const expected = await hmac(payload, secret);
  return timingSafeHexEqual(signature, expected) ? supplierId : null;
}
