import { createHash } from 'node:crypto';
import {
  GLOBAL_SOURCING_CAPABILITIES,
  normalizeGlobalSourcingSearchRequest,
  type GlobalSourcingCandidate,
  type GlobalSourcingProvider,
  type GlobalSourcingSearchRequest,
} from '@rafraf/shared/global-sourcing';

export const APM_PROVIDER_KEY = 'APM_GROUP';
export const APM_PROVIDER_NAME = 'APM Group';
export const APM_SEARCH_CODE_MAX_LENGTH = 64;
export const APM_TIMEOUT_MS = 10_000;

const APM_API_ORIGIN = 'https://api.apm.group';
const MAX_PROVIDER_BODY_BYTES = 1_000_000;

type FetchLike = typeof fetch;

export type ApmDiscoveryErrorCode =
  | 'APM_CODE_INVALID'
  | 'APM_TIMEOUT'
  | 'APM_UNAVAILABLE'
  | 'APM_RATE_LIMITED'
  | 'APM_AUTH_FAILED'
  | 'APM_REQUEST_REJECTED'
  | 'APM_RESPONSE_INVALID';

export class ApmDiscoveryError extends Error {
  readonly code: ApmDiscoveryErrorCode;
  readonly retryable: boolean;

  constructor(code: ApmDiscoveryErrorCode, retryable: boolean) {
    super(code);
    this.name = 'ApmDiscoveryError';
    this.code = code;
    this.retryable = retryable;
  }
}

export interface ApmDiscoveryConfig {
  baseUrl: typeof APM_API_ORIGIN;
  accountName: string;
  token: string;
  boundEgressIp: string;
}

export interface ApmDiscoveryStatus {
  enabled: boolean;
  configured: boolean;
  providerKey: typeof APM_PROVIDER_KEY;
  capability: 'SEARCH';
  boundEgressIpDeclared: boolean;
  staticEgressVerified: boolean;
}

interface ApmDiscoveryOptions {
  fetchImpl?: FetchLike;
  now?: () => number;
}

interface ApmProduct {
  id?: unknown;
  code?: unknown;
  name?: unknown;
  make?: unknown;
  price?: unknown;
  price_info?: unknown;
  currency?: unknown;
  currency_id?: unknown;
  available?: unknown;
  min_lot?: unknown;
  weight?: unknown;
  delivery?: unknown;
  priceName?: unknown;
  supplier_id?: unknown;
}

function trimmed(env: Record<string, string | undefined>, key: string): string {
  return env[key]?.trim() ?? '';
}

function isDeclaredIpv4(value: string): boolean {
  const octets = value.split('.');
  return (
    octets.length === 4 &&
    octets.every((octet) => {
      if (!/^\d{1,3}$/.test(octet)) return false;
      const numeric = Number(octet);
      return numeric >= 0 && numeric <= 255;
    })
  );
}

function isCanonicalApiOrigin(value: string): value is typeof APM_API_ORIGIN {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.origin === APM_API_ORIGIN &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

/**
 * APM tokens are bound to the IP that generated them. We require an explicit
 * static-egress declaration so a Vercel-style dynamic egress environment never
 * silently starts sending a long-lived account token to APM.
 */
export function apmDiscoveryConfigFromEnv(
  env: Record<string, string | undefined>,
): ApmDiscoveryConfig | null {
  if (trimmed(env, 'GLOBAL_SOURCING_APM_ENABLED').toLowerCase() !== 'true') {
    return null;
  }

  const baseUrl = trimmed(env, 'APM_API_BASE_URL');
  const accountName = trimmed(env, 'APM_ACCOUNT_NAME');
  const token = trimmed(env, 'APM_TOKEN');
  const boundEgressIp = trimmed(env, 'APM_TOKEN_BOUND_EGRESS_IP');
  const staticEgressVerified =
    trimmed(env, 'APM_STATIC_EGRESS_VERIFIED').toLowerCase() === 'true';
  const automaticOrderDisabled =
    trimmed(env, 'APM_AUTO_ORDER').toLowerCase() === 'false' &&
    trimmed(env, 'SUPPLIER_AUTO_ORDER').toLowerCase() === 'false';

  if (
    !isCanonicalApiOrigin(baseUrl) ||
    accountName.length < 3 ||
    accountName.length > 160 ||
    token.length < 16 ||
    token.length > 8_192 ||
    !isDeclaredIpv4(boundEgressIp) ||
    !staticEgressVerified ||
    !automaticOrderDisabled
  ) {
    return null;
  }

  return { baseUrl, accountName, token, boundEgressIp };
}

export function apmDiscoveryStatusFromEnv(
  env: Record<string, string | undefined>,
): ApmDiscoveryStatus {
  const enabled =
    trimmed(env, 'GLOBAL_SOURCING_APM_ENABLED').toLowerCase() === 'true';
  const boundEgressIp = trimmed(env, 'APM_TOKEN_BOUND_EGRESS_IP');
  return {
    enabled,
    configured: apmDiscoveryConfigFromEnv(env) !== null,
    providerKey: APM_PROVIDER_KEY,
    capability: 'SEARCH',
    boundEgressIpDeclared: isDeclaredIpv4(boundEgressIp),
    staticEgressVerified:
      trimmed(env, 'APM_STATIC_EGRESS_VERIFIED').toLowerCase() === 'true',
  };
}

export function apmDiscoveryStatus(): ApmDiscoveryStatus {
  return apmDiscoveryStatusFromEnv(process.env);
}

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function safeReference(value: unknown, maxLength: number): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return safeText(value, maxLength);
}

function safePartCode(value: unknown): string | null {
  const code = safeText(value, 80)?.toUpperCase() ?? null;
  return code && /^[A-Z0-9][A-Z0-9._/-]*$/.test(code) ? code : null;
}

function safeFiniteNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '') ||
    (typeof value !== 'number' && typeof value !== 'string')
  ) {
    return null;
  }
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum
    ? number
    : null;
}

function currencyFromProduct(product: ApmProduct): string | null {
  const explicit = safeText(product.currency, 3)?.toUpperCase() ?? null;
  if (explicit && /^[A-Z]{3}$/.test(explicit)) return explicit;
  const currencyId = String(product.currency_id ?? '').trim();
  if (currencyId === '1') return 'USD';
  if (currencyId === '4') return 'AED';
  return null;
}

export function normalizeApmSearchCode(query: string): string {
  const code = query.normalize('NFKC').trim().toUpperCase();
  if (
    code.length < 3 ||
    code.length > APM_SEARCH_CODE_MAX_LENGTH ||
    !/^[A-Z0-9][A-Z0-9._/-]*$/.test(code)
  ) {
    throw new ApmDiscoveryError('APM_CODE_INVALID', false);
  }
  return code;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mapProduct(
  input: ApmProduct,
  fetchedAt: string,
): GlobalSourcingCandidate | null {
  const partNumber = safePartCode(input.code);
  const productId = safeReference(input.id, 80);
  const warehouseCode = safeText(input.priceName, 80)?.toUpperCase() ?? null;
  const supplierReference = safeReference(input.supplier_id, 80);
  const manufacturer = safeText(input.make, 100);
  const productName = safeText(input.name, 160);
  const currency = currencyFromProduct(input);
  const rawPrice =
    safeFiniteNumber(input.price_info, 0.0001, 9_999_999_999.99) ??
    safeFiniteNumber(input.price, 0.0001, 9_999_999_999.99);
  if (
    !partNumber ||
    !productId ||
    !warehouseCode ||
    !supplierReference ||
    !productName ||
    !currency ||
    rawPrice === null
  ) {
    return null;
  }

  const availability = safeFiniteNumber(input.available, 0, 9_999_999);
  const minimumLot = safeFiniteNumber(input.min_lot, 1, 9_999_999);
  const weightKg = safeFiniteNumber(input.weight, 0, 99_999);
  const deliveryEstimate = safeText(input.delivery, 80);
  const title = [manufacturer, productName]
    .filter(Boolean)
    .join(' · ')
    .slice(0, 160);
  const externalId = `${productId}:${partNumber}:${warehouseCode}:${supplierReference}`;

  return {
    externalId,
    title: title || partNumber,
    rawPrice,
    currency,
    availability: availability === null ? null : String(availability),
    provenance: {
      providerKey: APM_PROVIDER_KEY,
      externalId,
      title: title || partNumber,
      discoveredAt: fetchedAt,
      itemWebUrl: null,
      listingMarketplaceId: null,
      itemLocationCountry: 'AE',
      condition: null,
      buyingOptions: [],
      fitmentEvidence: 'UNVERIFIED',
      supplierOffer: {
        partNumber,
        manufacturer,
        deliveryEstimate,
        weightKg,
        minimumLot,
        warehouseCode,
      },
    },
  };
}

async function parseBoundedJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  const declaredLength = contentLength === null ? null : Number(contentLength);
  if (
    declaredLength !== null &&
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PROVIDER_BODY_BYTES
  ) {
    try {
      await response.body?.cancel();
    } catch {
      // Size rejection remains authoritative if cancellation fails.
    }
    throw new ApmDiscoveryError('APM_RESPONSE_INVALID', false);
  }
  if (!response.body) {
    throw new ApmDiscoveryError('APM_RESPONSE_INVALID', false);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_PROVIDER_BODY_BYTES) {
        try {
          await reader.cancel('APM_RESPONSE_TOO_LARGE');
        } catch {
          // The response is rejected regardless of transport cancellation.
        }
        throw new ApmDiscoveryError('APM_RESPONSE_INVALID', false);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ApmDiscoveryError) throw error;
    try {
      await reader.cancel('APM_RESPONSE_READ_FAILED');
    } catch {
      // Normalize stream failures below.
    }
    throw new ApmDiscoveryError('APM_RESPONSE_INVALID', false);
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new ApmDiscoveryError('APM_RESPONSE_INVALID', false);
  }
}

function errorForStatus(status: number): ApmDiscoveryError {
  if (status === 429) return new ApmDiscoveryError('APM_RATE_LIMITED', true);
  if (status === 401 || status === 403) {
    return new ApmDiscoveryError('APM_AUTH_FAILED', false);
  }
  if (status >= 400 && status < 500) {
    return new ApmDiscoveryError('APM_REQUEST_REJECTED', false);
  }
  return new ApmDiscoveryError('APM_UNAVAILABLE', true);
}

export function createApmDiscovery(
  config: ApmDiscoveryConfig,
  options: ApmDiscoveryOptions = {},
): GlobalSourcingProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;

  return {
    key: APM_PROVIDER_KEY,
    capabilities: GLOBAL_SOURCING_CAPABILITIES,
    async search(input: GlobalSourcingSearchRequest) {
      const request = normalizeGlobalSourcingSearchRequest(input);
      const code = normalizeApmSearchCode(request.query);
      const signal = AbortSignal.timeout(APM_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetchImpl(`${config.baseUrl}/product/search`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: config.accountName,
            token: config.token,
            code,
            analogs: false,
          }),
          cache: 'no-store',
          signal,
        });
      } catch {
        throw new ApmDiscoveryError(
          signal.aborted ? 'APM_TIMEOUT' : 'APM_UNAVAILABLE',
          true,
        );
      }
      if (!response.ok) throw errorForStatus(response.status);

      const payload = toRecord(await parseBoundedJson(response));
      if (!payload) throw new ApmDiscoveryError('APM_RESPONSE_INVALID', false);

      const products: ApmProduct[] = [];
      let foundProductGroup = false;
      for (const group of Object.values(payload)) {
        const record = toRecord(group);
        if (!record || !('mainProducts' in record)) continue;
        foundProductGroup = true;
        if (!Array.isArray(record.mainProducts)) {
          throw new ApmDiscoveryError('APM_RESPONSE_INVALID', false);
        }
        products.push(...(record.mainProducts as ApmProduct[]));
      }
      if (!foundProductGroup) {
        throw new ApmDiscoveryError('APM_RESPONSE_INVALID', false);
      }

      const fetchedAt = new Date(now()).toISOString();
      const candidates: GlobalSourcingCandidate[] = [];
      for (const product of products) {
        const candidate = mapProduct(product, fetchedAt);
        if (!candidate) continue;
        candidates.push(candidate);
        if (candidates.length === request.limit) break;
      }
      return {
        providerKey: APM_PROVIDER_KEY,
        capability: 'SEARCH',
        fetchedAt,
        candidates,
      };
    },
  };
}

let runtimeProvider:
  { fingerprint: string; provider: GlobalSourcingProvider } | undefined;

export function configuredApmDiscovery(): GlobalSourcingProvider | null {
  const config = apmDiscoveryConfigFromEnv(process.env);
  if (!config) return null;
  const fingerprint = createHash('sha256')
    .update(
      [
        config.baseUrl,
        config.accountName,
        config.token,
        config.boundEgressIp,
      ].join('\0'),
    )
    .digest('hex');
  if (!runtimeProvider || runtimeProvider.fingerprint !== fingerprint) {
    runtimeProvider = { fingerprint, provider: createApmDiscovery(config) };
  }
  return runtimeProvider.provider;
}
