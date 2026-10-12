const OTO_REFRESH_URL = 'https://api.tryoto.com/rest/v2/refreshToken';
const OTO_HEALTH_URL = 'https://api.tryoto.com/rest/v2/healthCheck';
const OTO_READINESS_TIMEOUT_MS = 5_000;
const MAX_TOKEN_RESPONSE_BYTES = 32 * 1024;

export interface OtoShippingReadiness {
  configured: boolean;
  verified: boolean;
  ready: boolean;
  reason: string | null;
}

function opaque(value: string | undefined): string | null {
  const candidate = value?.trim() ?? '';
  return candidate.length >= 16 &&
    candidate.length <= 8_192 &&
    /^[A-Za-z0-9._~+/=-]+$/u.test(candidate)
    ? candidate
    : null;
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_TOKEN_RESPONSE_BYTES) {
    throw new Error('OTO_READINESS_RESPONSE_TOO_LARGE');
  }
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_TOKEN_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error('OTO_READINESS_RESPONSE_TOO_LARGE');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function otoShippingConfigured(
  env: Record<string, string | undefined>,
): boolean {
  return (
    env.OTO_ENABLED?.trim().toLowerCase() === 'true' &&
    opaque(env.OTO_REFRESH_TOKEN) !== null &&
    opaque(env.OTO_WEBHOOK_AUTH_KEY) !== null &&
    opaque(env.OTO_WEBHOOK_SECRET) !== null &&
    Boolean(env.OTO_PICKUP_LOCATION_CODE?.trim()) &&
    env.OTO_AUTO_CREATE_SHIPMENT?.trim().toLowerCase() === 'false' &&
    env.SHIPMENT_AUTO_CREATE?.trim().toLowerCase() === 'false'
  );
}

export async function otoShippingApiReadiness(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<OtoShippingReadiness> {
  if (!otoShippingConfigured(env)) {
    return {
      configured: false,
      verified: false,
      ready: false,
      reason: 'oto_operational_configuration_missing',
    };
  }
  const signal = AbortSignal.timeout(OTO_READINESS_TIMEOUT_MS);
  try {
    const refresh = await fetchImpl(OTO_REFRESH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: env.OTO_REFRESH_TOKEN?.trim() }),
      cache: 'no-store',
      redirect: 'error',
      signal,
    });
    if (!refresh.ok) {
      await refresh.body?.cancel().catch(() => undefined);
      return {
        configured: true,
        verified: false,
        ready: false,
        reason: 'oto_authentication_failed',
      };
    }
    const payload = (await boundedJson(refresh)) as Record<
      string,
      unknown
    > | null;
    const accessToken = opaque(
      typeof payload?.access_token === 'string'
        ? payload.access_token
        : typeof payload?.accessToken === 'string'
          ? payload.accessToken
          : typeof payload?.token === 'string'
            ? payload.token
            : undefined,
    );
    if (!accessToken) throw new Error('OTO_READINESS_TOKEN_INVALID');
    const health = await fetchImpl(OTO_HEALTH_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
      redirect: 'error',
      signal,
    });
    await health.body?.cancel().catch(() => undefined);
    if (!health.ok) {
      return {
        configured: true,
        verified: false,
        ready: false,
        reason: 'oto_health_check_failed',
      };
    }
    return { configured: true, verified: true, ready: true, reason: null };
  } catch {
    return {
      configured: true,
      verified: false,
      ready: false,
      reason: signal.aborted ? 'oto_readiness_timeout' : 'oto_unavailable',
    };
  }
}
