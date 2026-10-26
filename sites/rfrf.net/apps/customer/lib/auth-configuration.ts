/** Presence checks only: provider delivery and database reachability need separate verification. */
export function authenticationCoreConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(
    env.DATABASE_URL?.trim() && (env.SESSION_SECRET?.trim().length ?? 0) >= 32,
  );
}
