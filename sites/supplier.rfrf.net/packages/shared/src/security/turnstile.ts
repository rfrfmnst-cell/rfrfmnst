import { createHash, randomUUID } from 'node:crypto';

export const TURNSTILE_SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';
export const TURNSTILE_TEST_SECRET_KEY = '1x0000000000000000000000000000000AA';
export const TURNSTILE_RATE_LIMIT_SITE_KEY =
  'rafraf-rate-limit-fallback-v1';
export const TURNSTILE_RATE_LIMIT_TOKEN = 'rafraf-rate-limit-token-v1';
const TURNSTILE_DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const TURNSTILE_DOCUMENTED_TEST_SITE_KEYS = new Set([
  TURNSTILE_TEST_SITE_KEY,
  '2x00000000000000000000AB',
  '1x00000000000000000000BB',
  '2x00000000000000000000BB',
  '3x00000000000000000000FF',
]);
const TURNSTILE_DOCUMENTED_TEST_SECRET_KEYS = new Set([
  TURNSTILE_TEST_SECRET_KEY,
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
]);

const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export interface TurnstileConfiguration {
  siteKey: string;
  secretKey: string;
  allowedHostnames: readonly string[];
  testCredentials: boolean;
}

export type HumanVerificationMode =
  | 'turnstile'
  | 'rate_limit'
  | 'unconfigured';

export type TurnstileVerificationResult =
  | { ok: true; hostname: string }
  | {
      ok: false;
      reason:
        | 'configuration'
        | 'invalid_token'
        | 'rate_limited'
        | 'unavailable'
        | 'rejected'
        | 'action_mismatch'
        | 'hostname_mismatch'
        | 'stale_challenge';
    };

function hostnameFromValue(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  try {
    const hostname = new URL(
      normalized.includes('://') ? normalized : `https://${normalized}`,
    ).hostname;
    return HOSTNAME_PATTERN.test(hostname) ? hostname : null;
  } catch {
    return null;
  }
}

function configuredHostnames(env: NodeJS.ProcessEnv): string[] {
  return [
    ...new Set(
      (env.TURNSTILE_ALLOWED_HOSTNAMES ?? '')
        .split(',')
        .map((value) => hostnameFromValue(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

/**
 * Production accepts only real Cloudflare credentials. Local development gets
 * Cloudflare's documented test pair when no credentials are supplied.
 */
export function turnstileConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): TurnstileConfiguration | null {
  const productionEnvironment = env.NODE_ENV === 'production';
  const localDevelopment = !productionEnvironment;
  const siteKey =
    env.TURNSTILE_SITE_KEY?.trim() ||
    (localDevelopment ? TURNSTILE_TEST_SITE_KEY : '');
  const secretKey =
    env.TURNSTILE_SECRET_KEY?.trim() ||
    (localDevelopment ? TURNSTILE_TEST_SECRET_KEY : '');
  if (
    siteKey.length < 20 ||
    siteKey.length > 128 ||
    secretKey.length < 20 ||
    secretKey.length > 256
  ) {
    return null;
  }
  const testCredentials =
    siteKey === TURNSTILE_TEST_SITE_KEY &&
    secretKey === TURNSTILE_TEST_SECRET_KEY;
  const includesDocumentedTestCredential =
    TURNSTILE_DOCUMENTED_TEST_SITE_KEYS.has(siteKey) ||
    TURNSTILE_DOCUMENTED_TEST_SECRET_KEYS.has(secretKey);
  if (
    (includesDocumentedTestCredential && !testCredentials) ||
    (productionEnvironment && includesDocumentedTestCredential)
  ) {
    return null;
  }
  const allowedHostnames = configuredHostnames(env);
  if (localDevelopment && allowedHostnames.length === 0) {
    allowedHostnames.push('localhost', '127.0.0.1');
  }
  if (allowedHostnames.length === 0) return null;
  return { siteKey, secretKey, allowedHostnames, testCredentials };
}

/**
 * Explicit HUMAN_VERIFICATION_MODE always wins. Without an explicit mode,
 * production prefers real Turnstile when valid credentials exist and otherwise
 * degrades to the durable database-backed rate-limit guard instead of disabling
 * public authentication. Development continues to use the documented test pair.
 */
export function turnstileHumanVerificationMode(
  env: NodeJS.ProcessEnv = process.env,
): HumanVerificationMode {
  const selected = env.HUMAN_VERIFICATION_MODE?.trim().toLowerCase();
  const configuration = turnstileConfiguration(env);
  if (selected === 'rate_limit') return 'rate_limit';
  if (selected === 'turnstile') return configuration ? 'turnstile' : 'unconfigured';
  if (selected) return 'unconfigured';
  if (configuration) return 'turnstile';
  return env.NODE_ENV === 'production' ? 'rate_limit' : 'unconfigured';
}

export function turnstileRateLimitFallbackEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return turnstileHumanVerificationMode(env) === 'rate_limit';
}

export function turnstileSiteKey(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const mode = turnstileHumanVerificationMode(env);
  if (mode === 'rate_limit') return TURNSTILE_RATE_LIMIT_SITE_KEY;
  if (mode !== 'turnstile') return null;
  return turnstileConfiguration(env)?.siteKey ?? null;
}

/** Non-reversible identity used to attest deployment configuration parity. */
export function turnstileConfigurationFingerprint(
  env: NodeJS.ProcessEnv = process.env,
  readinessUrl?: string,
): string | null {
  const mode = turnstileHumanVerificationMode(env);
  if (mode === 'rate_limit') {
    return createHash('sha256')
      .update(JSON.stringify({ version: 2, mode: 'rate_limit' }))
      .digest('hex');
  }
  if (mode !== 'turnstile') return null;

  const configuration = turnstileConfiguration(env);
  if (!configuration) return null;

  let allowedHostnames = [...configuration.allowedHostnames];
  if (configuration.testCredentials && readinessUrl) {
    const readinessHostname = hostnameFromValue(readinessUrl);
    if (
      !readinessHostname ||
      !configuration.allowedHostnames.includes(readinessHostname)
    ) {
      return null;
    }
    allowedHostnames = [readinessHostname];
  }

  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 2,
        mode: 'turnstile',
        siteKey: configuration.siteKey,
        secretKey: configuration.secretKey,
        allowedHostnames: allowedHostnames.sort(),
      }),
    )
    .digest('hex');
}

interface TurnstileSiteverifyPayload {
  success?: unknown;
  challenge_ts?: unknown;
  hostname?: unknown;
  action?: unknown;
  metadata?: {
    result_with_testing_key?: unknown;
  };
}

export async function verifyTurnstileToken(
  input: {
    token: unknown;
    expectedAction: string;
    reserveSiteverify: () => Promise<'reserved' | 'rate_limited'>;
  },
  env: NodeJS.ProcessEnv = process.env,
  dependencies: {
    fetchImpl?: typeof fetch;
    now?: () => number;
    idempotencyKey?: () => string;
  } = {},
): Promise<TurnstileVerificationResult> {
  const mode = turnstileHumanVerificationMode(env);
  if (mode === 'unconfigured') return { ok: false, reason: 'configuration' };
  const configuration = mode === 'turnstile' ? turnstileConfiguration(env) : null;
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  if (
    !token ||
    token.length > 2_048 ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(input.expectedAction)
  ) {
    return { ok: false, reason: 'invalid_token' };
  }
  if (mode === 'rate_limit' && token !== TURNSTILE_RATE_LIMIT_TOKEN) {
    return { ok: false, reason: 'invalid_token' };
  }
  if (mode === 'turnstile' && !configuration) {
    return { ok: false, reason: 'configuration' };
  }

  let reservation: 'reserved' | 'rate_limited';
  try {
    reservation = await input.reserveSiteverify();
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (reservation !== 'reserved') {
    return { ok: false, reason: 'rate_limited' };
  }

  // No CAPTCHA success is claimed in rate-limit mode. A successful result means
  // only that the durable per-IP/global reservation succeeded; downstream OTP,
  // credential and registration quotas remain independently enforced.
  if (mode === 'rate_limit') {
    return { ok: true, hostname: 'rate-limit-only' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await (dependencies.fetchImpl ?? fetch)(
      TURNSTILE_SITEVERIFY_URL,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify({
          secret: configuration!.secretKey,
          response: token,
          idempotency_key: dependencies.idempotencyKey?.() ?? randomUUID(),
        }),
      },
    );
    if (!response.ok) return { ok: false, reason: 'unavailable' };
    const body = await response.text();
    if (body.length > 16_384) return { ok: false, reason: 'unavailable' };
    let payload: TurnstileSiteverifyPayload;
    try {
      payload = JSON.parse(body) as TurnstileSiteverifyPayload;
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
    if (payload.success !== true) return { ok: false, reason: 'rejected' };
    const officialDummyProof =
      configuration!.testCredentials && token === TURNSTILE_DUMMY_TOKEN;
    const officialTestingResponse =
      officialDummyProof && payload.metadata?.result_with_testing_key === true;
    const actionMatches =
      payload.action === input.expectedAction ||
      (officialDummyProof && payload.action === 'test') ||
      (officialTestingResponse && payload.action === undefined);
    if (!actionMatches) {
      return { ok: false, reason: 'action_mismatch' };
    }
    const hostname =
      typeof payload.hostname === 'string'
        ? payload.hostname.trim().toLowerCase()
        : '';
    const hostnameMatches =
      configuration!.allowedHostnames.includes(hostname) ||
      (officialTestingResponse && hostname === 'example.com');
    if (!hostnameMatches) {
      return { ok: false, reason: 'hostname_mismatch' };
    }
    const challengedAt =
      typeof payload.challenge_ts === 'string'
        ? Date.parse(payload.challenge_ts)
        : Number.NaN;
    const ageMs = (dependencies.now?.() ?? Date.now()) - challengedAt;
    if (
      !officialDummyProof &&
      (!Number.isFinite(challengedAt) || ageMs < -60_000 || ageMs > 360_000)
    ) {
      return { ok: false, reason: 'stale_challenge' };
    }
    return { ok: true, hostname };
  } catch {
    return { ok: false, reason: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}
