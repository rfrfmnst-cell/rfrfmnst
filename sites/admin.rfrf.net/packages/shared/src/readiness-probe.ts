import { timingSafeEqual } from 'node:crypto';

type HeaderReader = { get(name: string): string | null };

export const READINESS_PROBE_HEADER = 'x-rafraf-readiness-key';

/** Constant-time authorization for the deployment-only deep readiness probe. */
export function readinessProbeAuthorized(
  headers: HeaderReader,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = env.READINESS_PROBE_SECRET?.trim() ?? '';
  const supplied = headers.get(READINESS_PROBE_HEADER)?.trim() ?? '';
  if (
    expected.length < 32 ||
    expected.length > 256 ||
    supplied.length !== expected.length
  ) {
    return false;
  }
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}
