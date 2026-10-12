/**
 * Signed session tokens — pure, framework-free, Edge-safe.
 *
 * Format: `<subject>.<expiresAtEpochSeconds>.<hmacSha256Hex>`
 *
 * Kept free of `next/headers`, `process.env` and `node:crypto` so it can run in
 * a Next.js middleware (Edge runtime) and be unit-tested directly. Secret
 * resolution and cookie access belong to the calling app.
 */

export const MIN_SECRET_LENGTH = 32;

/** Thrown when a token is issued with an unusable secret. */
export class WeakSessionSecretError extends Error {
  constructor(length: number) {
    super(
      `Session secret must be at least ${MIN_SECRET_LENGTH} characters (got ${length}).`,
    );
    this.name = 'WeakSessionSecretError';
  }
}

export function isUsableSecret(secret: string | undefined | null): boolean {
  return typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
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
    encoder.encode(message),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Compares two digests without leaking their difference through timing. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Issues a token binding `subject` (a customer or supplier id) to an expiry.
 * Throws rather than returning a token an attacker could forge.
 */
export async function signSessionToken(
  secret: string,
  subject: string,
  ttlSeconds: number,
  nowMs: number = Date.now(),
): Promise<string> {
  if (!isUsableSecret(secret)) {
    throw new WeakSessionSecretError(secret?.length ?? 0);
  }
  if (!subject || subject.includes('.')) {
    throw new Error('Session subject must be non-empty and contain no "."');
  }
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error('Session ttlSeconds must be a positive number.');
  }

  const expiresAt = Math.floor(nowMs / 1000) + Math.floor(ttlSeconds);
  const payload = `${subject}.${expiresAt}`;
  return `${payload}.${await hmacHex(secret, payload)}`;
}

/**
 * Returns the subject when the token is well-formed, unexpired and correctly
 * signed; null in every other case. Never throws on malformed input.
 */
export async function verifySessionToken(
  secret: string | undefined | null,
  token: string | undefined | null,
  nowMs: number = Date.now(),
): Promise<string | null> {
  if (!token || !isUsableSecret(secret)) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [subject, expiresAtRaw, signature] = parts;
  if (!subject || !expiresAtRaw || !signature) return null;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= nowMs) return null;

  // Sign the raw string so no numeric normalisation can shift the payload.
  const expected = await hmacHex(secret as string, `${subject}.${expiresAtRaw}`);
  if (!timingSafeEqual(signature, expected)) return null;

  return subject;
}
