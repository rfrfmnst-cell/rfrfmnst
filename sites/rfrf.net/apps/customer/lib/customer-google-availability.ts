import { googleOAuthConfiguration } from './customer-google-oauth.ts';

/** Google is optional unless explicitly enabled; availability never means verification. */
export function customerGoogleAvailability(
  env: NodeJS.ProcessEnv = process.env,
) {
  const required = env.CUSTOMER_GOOGLE_AUTH_ENABLED?.trim() === 'true';
  const configuration = googleOAuthConfiguration(env);
  const configured = configuration !== null;
  return {
    enabled: required,
    required,
    configured,
    available: configured,
    deferred: !required,
    readinessAllowed: !required || configured,
    reason: !required
      ? 'provider_disabled'
      : configured
        ? null
        : 'provider_configuration_missing',
    redirectUri: configuration?.redirectUri ?? null,
  };
}
