import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import { exactPublicOrigin } from '@rafraf/shared/public-origin';
import type { JsonWebKey } from 'node:crypto';
import {
  normalizeCustomerEmail,
  normalizeCustomerName,
} from './customer-password.ts';

const STATE_TTL_SECONDS = 10 * 60;
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

export interface GoogleOAuthConfiguration {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface GoogleOAuthState {
  version: 1;
  state: string;
  codeVerifier: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

interface GoogleJwk extends JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
}

interface GoogleJwks {
  keys: GoogleJwk[];
}

interface GoogleClaims {
  iss?: unknown;
  aud?: unknown;
  azp?: unknown;
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  nonce?: unknown;
  iat?: unknown;
  exp?: unknown;
}

export interface VerifiedGoogleIdentity {
  subject: string;
  email: string;
  name: string;
}

const developmentSecret = randomBytes(32).toString('base64url');

function securitySecret(): string | null {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;
  return process.env.NODE_ENV !== 'production' ? developmentSecret : null;
}

export function googleOAuthConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): GoogleOAuthConfiguration | null {
  const enabled = env.CUSTOMER_GOOGLE_AUTH_ENABLED?.trim() === 'true';
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? '';
  const origin = exactPublicOrigin(
    env.CUSTOMER_PUBLIC_URL,
    env.NODE_ENV === 'production',
  );
  if (
    !enabled ||
    !origin ||
    clientId.length < 10 ||
    clientId.length > 512 ||
    clientSecret.length < 8 ||
    clientSecret.length > 512
  ) {
    return null;
  }
  return {
    clientId,
    clientSecret,
    redirectUri: `${origin}/api/auth/google/callback`,
  };
}

function stateSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`customer-google-oauth:${payload}`)
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

export function createGoogleOAuthState(nowMs = Date.now()): {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  nonce: string;
  cookie: string;
} {
  const secret = securitySecret();
  if (!secret) throw new Error('SESSION_SECRET_CONFIGURATION');
  const issuedAt = Math.floor(nowMs / 1000);
  const state = randomBytes(24).toString('base64url');
  const codeVerifier = randomBytes(48).toString('base64url');
  const nonce = randomBytes(24).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      state,
      codeVerifier,
      nonce,
      issuedAt,
      expiresAt: issuedAt + STATE_TTL_SECONDS,
    } satisfies GoogleOAuthState),
  ).toString('base64url');
  return {
    state,
    codeVerifier,
    codeChallenge: createHash('sha256')
      .update(codeVerifier)
      .digest('base64url'),
    nonce,
    cookie: `${payload}.${stateSignature(payload, secret)}`,
  };
}

export function parseGoogleOAuthState(
  value: string | undefined,
  nowMs = Date.now(),
): GoogleOAuthState | null {
  const secret = securitySecret();
  if (!secret || !value || value.length > 2_048) return null;
  const [payload, suppliedSignature, ...extra] = value.split('.');
  if (!payload || !suppliedSignature || extra.length > 0) return null;
  if (!safeEqual(suppliedSignature, stateSignature(payload, secret)))
    return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as Partial<GoogleOAuthState>;
    const now = Math.floor(nowMs / 1000);
    if (
      parsed.version !== 1 ||
      typeof parsed.state !== 'string' ||
      !/^[A-Za-z0-9_-]{32}$/.test(parsed.state) ||
      typeof parsed.codeVerifier !== 'string' ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(parsed.codeVerifier) ||
      typeof parsed.nonce !== 'string' ||
      !/^[A-Za-z0-9_-]{32}$/.test(parsed.nonce) ||
      !Number.isSafeInteger(parsed.issuedAt) ||
      !Number.isSafeInteger(parsed.expiresAt) ||
      parsed.issuedAt! > now + 60 ||
      parsed.expiresAt! <= now ||
      parsed.expiresAt! - parsed.issuedAt! !== STATE_TTL_SECONDS
    ) {
      return null;
    }
    return parsed as GoogleOAuthState;
  } catch {
    return null;
  }
}

let cachedKeys: { expiresAt: number; value: GoogleJwks } | null = null;

async function loadGoogleKeys(): Promise<GoogleJwks> {
  const now = Date.now();
  if (cachedKeys && cachedKeys.expiresAt > now) return cachedKeys.value;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(GOOGLE_JWKS_URL, {
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('GOOGLE_JWKS_UNAVAILABLE');
    const text = await response.text();
    if (text.length > 128_000) throw new Error('GOOGLE_JWKS_INVALID');
    const parsed = JSON.parse(text) as GoogleJwks;
    if (!Array.isArray(parsed.keys) || parsed.keys.length > 20) {
      throw new Error('GOOGLE_JWKS_INVALID');
    }
    cachedKeys = { expiresAt: now + 60 * 60 * 1000, value: parsed };
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

function decodeJsonPart(value: string): Record<string, unknown> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 16_384) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function verifyGoogleIdToken(
  token: string,
  clientId: string,
  dependencies: {
    nowMs?: number;
    loadKeys?: () => Promise<GoogleJwks>;
    expectedNonce?: string;
  } = {},
): Promise<VerifiedGoogleIdentity | null> {
  if (!token || token.length > 32_768) return null;
  const [headerRaw, payloadRaw, signatureRaw, ...extra] = token.split('.');
  if (!headerRaw || !payloadRaw || !signatureRaw || extra.length > 0)
    return null;
  const header = decodeJsonPart(headerRaw);
  const claims = decodeJsonPart(payloadRaw) as GoogleClaims | null;
  if (
    !header ||
    header.alg !== 'RS256' ||
    typeof header.kid !== 'string' ||
    !claims
  ) {
    return null;
  }
  try {
    const jwks = await (dependencies.loadKeys ?? loadGoogleKeys)();
    const key = jwks.keys.find(
      (candidate) =>
        candidate.kid === header.kid &&
        candidate.kty === 'RSA' &&
        (!candidate.alg || candidate.alg === 'RS256') &&
        (!candidate.use || candidate.use === 'sig'),
    );
    if (!key) return null;
    const signatureBytes = Buffer.from(signatureRaw, 'base64url');
    if (
      !verify(
        'RSA-SHA256',
        Buffer.from(`${headerRaw}.${payloadRaw}`),
        createPublicKey({ key, format: 'jwk' }),
        signatureBytes,
      )
    ) {
      return null;
    }
  } catch {
    return null;
  }

  const now = Math.floor((dependencies.nowMs ?? Date.now()) / 1000);
  const audience = Array.isArray(claims.aud)
    ? claims.aud.filter((value): value is string => typeof value === 'string')
    : typeof claims.aud === 'string'
      ? [claims.aud]
      : [];
  if (
    !['accounts.google.com', 'https://accounts.google.com'].includes(
      typeof claims.iss === 'string' ? claims.iss : '',
    ) ||
    !audience.includes(clientId) ||
    (audience.length > 1 && claims.azp !== clientId) ||
    typeof claims.exp !== 'number' ||
    !Number.isSafeInteger(claims.exp) ||
    claims.exp <= now ||
    typeof claims.iat !== 'number' ||
    !Number.isSafeInteger(claims.iat) ||
    claims.iat > now + 60 ||
    typeof claims.sub !== 'string' ||
    !/^\d{6,255}$/.test(claims.sub) ||
    claims.email_verified !== true
  ) {
    return null;
  }
  if (
    dependencies.expectedNonce !== undefined &&
    claims.nonce !== dependencies.expectedNonce
  ) {
    return null;
  }
  const email = normalizeCustomerEmail(claims.email);
  const name = normalizeCustomerName(claims.name) ?? 'عميل رفرف';
  return email ? { subject: claims.sub, email, name } : null;
}

export async function exchangeGoogleAuthorizationCode(
  code: string,
  codeVerifier: string,
  configuration: GoogleOAuthConfiguration,
  nonce: string,
): Promise<VerifiedGoogleIdentity | null> {
  if (!code || code.length > 4_096) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7_000);
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: configuration.clientId,
        client_secret: configuration.clientSecret,
        redirect_uri: configuration.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > 32_768) return null;
    const body = JSON.parse(text) as { id_token?: unknown };
    return typeof body.id_token === 'string'
      ? verifyGoogleIdToken(body.id_token, configuration.clientId, {
          expectedNonce: nonce,
        })
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export const googleOAuthCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/auth/google',
  maxAge: STATE_TTL_SECONDS,
};
