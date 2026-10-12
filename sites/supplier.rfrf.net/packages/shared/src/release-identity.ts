/** Canonical runtime identity, with the legacy web variable as a fallback. */
export function readReleaseSha(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const value =
    env.RAFRAF_RELEASE_SHA?.trim() || env.VERCEL_GIT_COMMIT_SHA?.trim() || '';
  if (!/^[0-9a-f]{7,64}$/i.test(value) || /^0+$/.test(value)) return null;
  return value;
}

/** Readiness requires the full Git SHA used by the production release gate. */
export function releaseIsBound(release: string | null): boolean {
  return (
    release !== null && /^[0-9a-f]{40}$/i.test(release) && !/^0+$/.test(release)
  );
}
