import { createHmac, randomBytes } from 'node:crypto';

const DEVELOPMENT_SUBJECT_SECRET = randomBytes(32).toString('base64url');

type HeaderReader = { get(name: string): string | null };

function subjectSecret(env: NodeJS.ProcessEnv): string | null {
  const configured = env.SESSION_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;
  return env.NODE_ENV === 'production' ? null : DEVELOPMENT_SUBJECT_SECRET;
}

/** HMACs an abuse-control subject without retaining its raw value. */
export function opaqueRequestSubject(
  scope: string,
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const secret = subjectSecret(env);
  const normalizedScope = scope.trim().slice(0, 48);
  const normalizedValue = value.trim().slice(0, 256);
  if (!secret || !normalizedScope || !normalizedValue) return null;
  return createHmac('sha256', secret)
    .update(`rafraf-request-subject:v1:${normalizedScope}:${normalizedValue}`)
    .digest('hex');
}

/** Proxies that append to `X-Forwarded-For` between the client and this app. */
const DEFAULT_TRUSTED_PROXY_HOPS = 1;
const MAX_TRUSTED_PROXY_HOPS = 8;

function trustedProxyHops(env: NodeJS.ProcessEnv): number {
  const raw = Number.parseInt(env.TRUSTED_PROXY_HOPS?.trim() ?? '', 10);
  if (!Number.isInteger(raw) || raw < 1 || raw > MAX_TRUSTED_PROXY_HOPS) {
    return DEFAULT_TRUSTED_PROXY_HOPS;
  }
  return raw;
}

/**
 * Reads the client address a trusted proxy appended, never one the client sent.
 *
 * `X-Forwarded-For` grows left to right: the client may put anything at the
 * front, and every proxy appends the peer it actually saw. So the entry our own
 * edge wrote sits `TRUSTED_PROXY_HOPS` from the end, and everything left of it
 * is attacker-controlled. Taking the leftmost entry — the previous behaviour,
 * written when Vercel terminated TLS — lets one host mint unlimited abuse-control
 * identities and exhaust every quota keyed on this subject.
 *
 * `X-Real-IP` is deliberately ignored outside Vercel: the current edge does not
 * set it, so it carries only whatever the client chose to send.
 *
 * An absent or malformed address shares one fail-closed bucket rather than
 * disabling rate limiting.
 */
export function requestIpSubject(
  headers: HeaderReader,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const chain =
    env.VERCEL === '1'
      ? headers.get('x-vercel-forwarded-for') ||
        headers.get('x-forwarded-for') ||
        ''
      : headers.get('x-forwarded-for') || '';

  const hops = chain
    .split(',')
    .map((hop) => hop.trim())
    .filter((hop) => hop.length > 0 && hop.length <= 64);

  // Vercel hands over an already-trimmed chain; elsewhere our edge appends last.
  const index = env.VERCEL === '1' ? 0 : hops.length - trustedProxyHops(env);
  const address = (index >= 0 ? hops[index] : undefined) ?? 'unknown';

  return opaqueRequestSubject('client-address', address, env);
}
