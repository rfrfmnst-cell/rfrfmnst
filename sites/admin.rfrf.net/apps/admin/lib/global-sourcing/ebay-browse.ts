import { createHash } from 'node:crypto';
import {
  GLOBAL_SOURCING_CAPABILITIES,
  normalizeGlobalSourcingSearchRequest,
  type GlobalSourcingCandidate,
  type GlobalSourcingProvider,
  type GlobalSourcingSearchRequest,
} from '@rafraf/shared/global-sourcing';
import { EbayBrowseDiscoveryError } from './ebay-browse-errors.ts';
import { errorForStatus, parseBoundedJson } from './ebay-browse-response.ts';

export { EbayBrowseDiscoveryError } from './ebay-browse-errors.ts';
export type { EbayBrowseErrorCode } from './ebay-browse-errors.ts';

export const EBAY_BROWSE_PROVIDER_KEY = 'EBAY_BROWSE';
export const EBAY_BROWSE_PROVIDER_NAME = 'eBay Browse Discovery';
export const EBAY_BROWSE_QUERY_MAX_LENGTH = 100;
export const EBAY_BROWSE_TIMEOUT_MS = 10_000;

const EBAY_SCOPE = 'https://api.ebay.com/oauth/api_scope';
const EBAY_ITEM_HOSTS_BY_MARKETPLACE: Readonly<
  Record<string, readonly string[]>
> = {
  EBAY_US: ['www.ebay.com'],
  EBAY_AT: ['www.ebay.at'],
  EBAY_AU: ['www.ebay.com.au'],
  EBAY_BE: ['www.benl.ebay.be', 'www.befr.ebay.be'],
  EBAY_CA: ['www.ebay.ca', 'www.cafr.ebay.ca'],
  EBAY_CH: ['www.ebay.ch'],
  EBAY_DE: ['www.ebay.de'],
  EBAY_ES: ['www.ebay.es'],
  EBAY_FR: ['www.ebay.fr'],
  EBAY_GB: ['www.ebay.co.uk'],
  EBAY_HK: ['www.ebay.com.hk'],
  EBAY_IE: ['www.ebay.ie'],
  EBAY_IT: ['www.ebay.it'],
  EBAY_MY: ['www.ebay.com.my'],
  EBAY_NL: ['www.ebay.nl'],
  EBAY_PH: ['www.ebay.ph'],
  EBAY_PL: ['www.ebay.pl'],
  EBAY_SG: ['www.ebay.com.sg'],
  EBAY_TW: ['www.ebay.com.tw'],
  EBAY_MOTORS_US: ['www.ebay.com'],
};

// Browse item_summary search currently supports this explicit subset only.
// Keep it separate from the URL host map: a valid eBay site is not proof that
// the Browse search endpoint accepts its Marketplace ID.
const BROWSE_SEARCH_MARKETPLACE_IDS = new Set([
  'EBAY_AT',
  'EBAY_AU',
  'EBAY_BE',
  'EBAY_CA',
  'EBAY_CH',
  'EBAY_DE',
  'EBAY_ES',
  'EBAY_FR',
  'EBAY_GB',
  'EBAY_HK',
  'EBAY_IE',
  'EBAY_IT',
  'EBAY_NL',
  'EBAY_PL',
  'EBAY_SG',
  'EBAY_US',
]);

type EbayEnvironment = 'production' | 'sandbox';
type FetchLike = typeof fetch;

export interface EbayBrowseConfig {
  environment: EbayEnvironment;
  clientId: string;
  clientSecret: string;
  marketplaceId: string;
  deliveryCountry: 'SA';
}

export interface EbayBrowseDiscoveryStatus {
  enabled: boolean;
  configured: boolean;
  providerKey: typeof EBAY_BROWSE_PROVIDER_KEY;
  capability: 'SEARCH';
  environment: EbayEnvironment | null;
  marketplaceId: string | null;
  deliveryCountry: 'SA' | null;
}

interface EbayBrowseDiscoveryOptions {
  fetchImpl?: FetchLike;
  now?: () => number;
}

interface EbayTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
}

interface EbayItemSummary {
  itemId?: unknown;
  title?: unknown;
  price?: { value?: unknown; currency?: unknown };
  buyingOptions?: unknown;
  itemWebUrl?: unknown;
  listingMarketplaceId?: unknown;
  itemLocation?: { country?: unknown };
  condition?: unknown;
  compatibilityMatch?: unknown;
}

interface EbaySearchResponse {
  itemSummaries?: unknown;
}

function trimmed(env: Record<string, string | undefined>, key: string): string {
  return env[key]?.trim() ?? '';
}

export function ebayBrowseConfigFromEnv(
  env: Record<string, string | undefined>,
): EbayBrowseConfig | null {
  if (trimmed(env, 'GLOBAL_SOURCING_EBAY_ENABLED').toLowerCase() !== 'true') {
    return null;
  }

  const environment = trimmed(env, 'EBAY_BROWSE_ENVIRONMENT');
  const clientId = trimmed(env, 'EBAY_CLIENT_ID');
  const clientSecret = trimmed(env, 'EBAY_CLIENT_SECRET');
  const marketplaceId = trimmed(env, 'EBAY_MARKETPLACE_ID').toUpperCase();
  const deliveryCountry = trimmed(env, 'EBAY_DELIVERY_COUNTRY').toUpperCase();

  if (
    (environment !== 'production' && environment !== 'sandbox') ||
    clientId.length < 8 ||
    clientSecret.length < 16 ||
    !BROWSE_SEARCH_MARKETPLACE_IDS.has(marketplaceId) ||
    deliveryCountry !== 'SA'
  ) {
    return null;
  }

  return {
    environment,
    clientId,
    clientSecret,
    marketplaceId,
    deliveryCountry,
  };
}

export function ebayBrowseDiscoveryStatusFromEnv(
  env: Record<string, string | undefined>,
): EbayBrowseDiscoveryStatus {
  const enabled =
    trimmed(env, 'GLOBAL_SOURCING_EBAY_ENABLED').toLowerCase() === 'true';
  const config = ebayBrowseConfigFromEnv(env);
  return {
    enabled,
    configured: config !== null,
    providerKey: EBAY_BROWSE_PROVIDER_KEY,
    capability: 'SEARCH',
    environment: config?.environment ?? null,
    marketplaceId: config?.marketplaceId ?? null,
    deliveryCountry: config?.deliveryCountry ?? null,
  };
}

export function ebayBrowseDiscoveryStatus(): EbayBrowseDiscoveryStatus {
  return ebayBrowseDiscoveryStatusFromEnv(process.env);
}

function endpoints(environment: EbayEnvironment) {
  const origin =
    environment === 'production'
      ? 'https://api.ebay.com'
      : 'https://api.sandbox.ebay.com';
  return {
    token: `${origin}/identity/v1/oauth2/token`,
    search: `${origin}/buy/browse/v1/item_summary/search`,
  };
}

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

export function safeEbayItemUrl(
  value: unknown,
  marketplaceId: unknown,
): string | null {
  if (typeof value !== 'string') return null;
  const normalizedMarketplaceId =
    typeof marketplaceId === 'string' ? marketplaceId.trim().toUpperCase() : '';
  const allowedHosts = EBAY_ITEM_HOSTS_BY_MARKETPLACE[normalizedMarketplaceId];
  if (!allowedHosts || value.length > 1_000) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.port !== '' ||
      !allowedHosts.includes(host)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function mapCandidate(
  item: EbayItemSummary,
  fetchedAt: string,
): GlobalSourcingCandidate | null {
  const externalId = safeText(item.itemId, 250);
  const title = safeText(item.title, 160);
  const rawPrice = Number(item.price?.value);
  const currency = safeText(item.price?.currency, 3)?.toUpperCase() ?? '';
  if (
    !externalId ||
    !title ||
    !Number.isFinite(rawPrice) ||
    rawPrice <= 0 ||
    rawPrice > 9_999_999_999.99 ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    return null;
  }

  const buyingOptions = Array.isArray(item.buyingOptions)
    ? item.buyingOptions
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 4)
    : [];
  const itemLocationCountry = safeText(
    item.itemLocation?.country,
    2,
  )?.toUpperCase();
  const listingMarketplaceId = safeText(
    item.listingMarketplaceId,
    32,
  )?.toUpperCase();

  return {
    externalId,
    title,
    rawPrice,
    currency,
    availability: null,
    provenance: {
      providerKey: EBAY_BROWSE_PROVIDER_KEY,
      externalId,
      title,
      discoveredAt: fetchedAt,
      itemWebUrl: safeEbayItemUrl(item.itemWebUrl, listingMarketplaceId),
      listingMarketplaceId:
        listingMarketplaceId &&
        BROWSE_SEARCH_MARKETPLACE_IDS.has(listingMarketplaceId)
          ? listingMarketplaceId
          : null,
      itemLocationCountry:
        itemLocationCountry && /^[A-Z]{2}$/.test(itemLocationCountry)
          ? itemLocationCountry
          : null,
      condition: safeText(item.condition, 80),
      buyingOptions,
      // This adapter deliberately sends no compatibility_filter. A response
      // field or listing title can therefore never establish fitment.
      fitmentEvidence: 'UNVERIFIED',
    },
  };
}

export function createEbayBrowseDiscovery(
  config: EbayBrowseConfig,
  options: EbayBrowseDiscoveryOptions = {},
): GlobalSourcingProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  let cachedToken: { value: string; expiresAt: number } | null = null;

  async function accessToken(signal: AbortSignal, force = false) {
    if (!force && cachedToken && cachedToken.expiresAt > now() + 60_000) {
      return cachedToken.value;
    }

    let response: Response;
    try {
      response = await fetchImpl(endpoints(config.environment).token, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          scope: EBAY_SCOPE,
        }),
        cache: 'no-store',
        signal,
      });
    } catch {
      throw new EbayBrowseDiscoveryError(
        signal.aborted ? 'EBAY_TIMEOUT' : 'EBAY_UNAVAILABLE',
        true,
      );
    }
    if (!response.ok) throw errorForStatus(response.status);

    const payload = (await parseBoundedJson(response)) as EbayTokenResponse;
    const token = safeText(payload.access_token, 8_192);
    const expiresIn = Number(payload.expires_in);
    if (
      !token ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 60 ||
      expiresIn > 86_400
    ) {
      throw new EbayBrowseDiscoveryError('EBAY_RESPONSE_INVALID', false);
    }
    cachedToken = { value: token, expiresAt: now() + expiresIn * 1_000 };
    return token;
  }

  async function searchWithToken(
    request: GlobalSourcingSearchRequest,
    token: string,
    signal: AbortSignal,
  ): Promise<Response> {
    const url = new URL(endpoints(config.environment).search);
    url.searchParams.set('q', request.query);
    url.searchParams.set('limit', String(request.limit));
    url.searchParams.set('filter', `deliveryCountry:${config.deliveryCountry}`);

    try {
      return await fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'X-EBAY-C-ENDUSERCTX': `contextualLocation=country%3D${config.deliveryCountry}`,
          'X-EBAY-C-MARKETPLACE-ID': config.marketplaceId,
        },
        cache: 'no-store',
        signal,
      });
    } catch {
      throw new EbayBrowseDiscoveryError(
        signal.aborted ? 'EBAY_TIMEOUT' : 'EBAY_UNAVAILABLE',
        true,
      );
    }
  }

  return {
    key: EBAY_BROWSE_PROVIDER_KEY,
    capabilities: GLOBAL_SOURCING_CAPABILITIES,
    async search(input) {
      const request = normalizeGlobalSourcingSearchRequest(input);
      if (request.query.length > EBAY_BROWSE_QUERY_MAX_LENGTH) {
        throw new EbayBrowseDiscoveryError('EBAY_QUERY_TOO_LONG', false);
      }

      const signal = AbortSignal.timeout(EBAY_BROWSE_TIMEOUT_MS);
      let token = await accessToken(signal);
      let response = await searchWithToken(request, token, signal);
      if (response.status === 401 && !signal.aborted) {
        cachedToken = null;
        token = await accessToken(signal, true);
        response = await searchWithToken(request, token, signal);
      }
      if (!response.ok) throw errorForStatus(response.status);

      const payload = (await parseBoundedJson(response)) as EbaySearchResponse;
      if (
        payload.itemSummaries !== undefined &&
        !Array.isArray(payload.itemSummaries)
      ) {
        throw new EbayBrowseDiscoveryError('EBAY_RESPONSE_INVALID', false);
      }
      const fetchedAt = new Date(now()).toISOString();
      const items = (payload.itemSummaries ?? []) as EbayItemSummary[];
      const candidates = items
        .slice(0, request.limit)
        .map((item) => mapCandidate(item, fetchedAt))
        .filter((item): item is GlobalSourcingCandidate => item !== null)
        .slice(0, request.limit);

      return {
        providerKey: EBAY_BROWSE_PROVIDER_KEY,
        capability: 'SEARCH',
        fetchedAt,
        candidates,
      };
    },
  };
}

let runtimeProvider:
  { fingerprint: string; provider: GlobalSourcingProvider } | undefined;

export function configuredEbayBrowseDiscovery(): GlobalSourcingProvider | null {
  const config = ebayBrowseConfigFromEnv(process.env);
  if (!config) return null;
  const fingerprint = createHash('sha256')
    .update(
      [
        config.environment,
        config.clientId,
        config.clientSecret,
        config.marketplaceId,
        config.deliveryCountry,
      ].join('\0'),
    )
    .digest('hex');
  if (!runtimeProvider || runtimeProvider.fingerprint !== fingerprint) {
    runtimeProvider = {
      fingerprint,
      provider: createEbayBrowseDiscovery(config),
    };
  }
  return runtimeProvider.provider;
}
