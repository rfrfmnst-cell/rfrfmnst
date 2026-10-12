export const OTO_PROVIDER_KEY = 'OTO';

export interface OtoFulfillmentConfig {
  refreshToken: string;
}

export interface OtoWebhookConfig {
  authorizationKey: string;
  signingSecret: string;
}

export interface OtoFulfillmentStatus {
  enabled: boolean;
  configured: boolean;
  providerKey: typeof OTO_PROVIDER_KEY;
  capability: 'RATES';
  capabilities:
    | readonly ['RATES']
    | readonly ['RATES', 'CREATE_SHIPMENT', 'TRACK', 'AWB', 'WEBHOOK'];
  autoShipmentCreationDisabled: boolean;
  webhookConfigured: boolean;
  operationalConfigured: boolean;
}

function trimmed(env: Record<string, string | undefined>, key: string): string {
  return env[key]?.trim() ?? '';
}

export function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}

export function opaqueToken(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length < 16 ||
    value.length > 8_192 ||
    value.trim() !== value ||
    hasControlCharacter(value) ||
    !/^[A-Za-z0-9._~+/=-]+$/u.test(value)
  ) {
    return null;
  }
  return value;
}

/**
 * OTO is enabled only when the server-only refresh token is present and both
 * independent shipment-write guards are explicitly false.
 */
export function otoFulfillmentConfigFromEnv(
  env: Record<string, string | undefined>,
): OtoFulfillmentConfig | null {
  if (trimmed(env, 'OTO_ENABLED').toLowerCase() !== 'true') {
    return null;
  }
  const refreshToken = opaqueToken(trimmed(env, 'OTO_REFRESH_TOKEN'));
  const automaticShipmentDisabled =
    trimmed(env, 'OTO_AUTO_CREATE_SHIPMENT').toLowerCase() === 'false' &&
    trimmed(env, 'SHIPMENT_AUTO_CREATE').toLowerCase() === 'false';
  if (!refreshToken || !automaticShipmentDisabled) return null;
  return { refreshToken };
}

export function otoWebhookConfigFromEnv(
  env: Record<string, string | undefined>,
): OtoWebhookConfig | null {
  const authorizationKey = opaqueToken(trimmed(env, 'OTO_WEBHOOK_AUTH_KEY'));
  const signingSecret = opaqueToken(trimmed(env, 'OTO_WEBHOOK_SECRET'));
  return authorizationKey && signingSecret
    ? { authorizationKey, signingSecret }
    : null;
}

export function otoFulfillmentStatusFromEnv(
  env: Record<string, string | undefined>,
): OtoFulfillmentStatus {
  const enabled = trimmed(env, 'OTO_ENABLED').toLowerCase() === 'true';
  const automaticShipmentCreationDisabled =
    trimmed(env, 'OTO_AUTO_CREATE_SHIPMENT').toLowerCase() === 'false' &&
    trimmed(env, 'SHIPMENT_AUTO_CREATE').toLowerCase() === 'false';
  const rateConfigured = otoFulfillmentConfigFromEnv(env) !== null;
  const webhookConfigured = otoWebhookConfigFromEnv(env) !== null;
  const operationalConfigured = rateConfigured && webhookConfigured;
  return {
    enabled,
    configured: rateConfigured,
    providerKey: OTO_PROVIDER_KEY,
    capability: 'RATES',
    capabilities: operationalConfigured
      ? ['RATES', 'CREATE_SHIPMENT', 'TRACK', 'AWB', 'WEBHOOK']
      : ['RATES'],
    autoShipmentCreationDisabled: automaticShipmentCreationDisabled,
    webhookConfigured,
    operationalConfigured,
  };
}

export function otoFulfillmentStatus(): OtoFulfillmentStatus {
  return otoFulfillmentStatusFromEnv(process.env);
}
