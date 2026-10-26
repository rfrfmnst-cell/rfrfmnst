/** Live intake remains closed until Tap refunds and end-to-end evidence pass. */
export function tapPaymentLaunchStatus(
  env: Record<string, string | undefined>,
) {
  const mode = env.PAYMENT_MODE?.trim().toLowerCase();
  const preview =
    env.VERCEL_ENV === 'preview' ||
    (!env.VERCEL_ENV && env.NODE_ENV !== 'production');
  const config =
    env.TAP_MODE === 'sandbox' &&
    Boolean(env.SUPABASE_SERVICE_ROLE_KEY?.trim()) &&
    env.SUPABASE_URL?.replace(/\/$/, '') ===
      'https://gfxnwfjjpxmzvnylushd.supabase.co';
  let publicOrigin = false;
  try {
    const url = new URL(env.CUSTOMER_PUBLIC_URL ?? '');
    publicOrigin =
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash;
  } catch {
    /* Missing origin fails closed. */
  }
  const allowed = mode === 'sandbox' && preview && config && publicOrigin;
  return {
    mode:
      mode === 'sandbox'
        ? ('sandbox' as const)
        : mode === 'live'
          ? ('live' as const)
          : ('invalid' as const),
    launchRequired: true,
    checkoutAllowed: allowed,
    readinessAllowed: allowed,
    reason: allowed
      ? null
      : mode === 'live'
        ? 'tap_live_acceptance_pending'
        : !preview
          ? 'sandbox_environment_invalid'
          : !config
            ? 'tap_bridge_configuration_missing'
            : !publicOrigin
              ? 'customer_public_origin_missing'
              : 'payment_mode_invalid',
  };
}
