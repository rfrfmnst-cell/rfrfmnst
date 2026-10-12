import { createHash } from 'node:crypto';
import {
  GLOBAL_SOURCING_CAPABILITIES,
  normalizeGlobalSourcingSearchRequest,
  type GlobalSourcingCandidate,
  type GlobalSourcingProvider,
  type GlobalSourcingSearchRequest,
} from '@rafraf/shared/global-sourcing';
import { readBoundedJson } from './bounded-json.ts';

export const ABCP_PROVIDER_KEY = 'ABCP_UAE';
export const ABCP_PROVIDER_NAME = 'ABCP UAE wholesalers';
export const ABCP_PART_NUMBER_MAX_LENGTH = 64;
export const ABCP_TIMEOUT_MS = 10_000;
export const ABCP_MAX_SUPPLIERS = 5;
/** Brands searched per supplier for one part number. */
export const ABCP_MAX_BRANDS = 3;

// Each wholesaler on ABCP runs the client API on its own host under this zone;
// the exact host comes from that wholesaler's managers.
const ABCP_HOST =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.public\.api\.abcp\.ru$/u;
const SUPPLIER_CODE = /^[A-Z][A-Z0-9_]{1,31}$/u;
const SUPPORTED_CURRENCIES = new Set(['AED', 'USD', 'EUR', 'SAR']);
const MAX_PROVIDER_BODY_BYTES = 1_000_000;
// ABCP answers "object not found" when no brand carries the number.
const ABCP_NOT_FOUND = 301;

type FetchLike = typeof fetch;

export type AbcpDiscoveryErrorCode =
  | 'ABCP_CODE_INVALID'
  | 'ABCP_TIMEOUT'
  | 'ABCP_UNAVAILABLE'
  | 'ABCP_RATE_LIMITED'
  | 'ABCP_ACCESS_BLOCKED'
  | 'ABCP_AUTH_FAILED'
  | 'ABCP_REQUEST_REJECTED'
  | 'ABCP_RESPONSE_INVALID';

export class AbcpDiscoveryError extends Error {
  readonly code: AbcpDiscoveryErrorCode;
  readonly retryable: boolean;

  constructor(code: AbcpDiscoveryErrorCode, retryable: boolean) {
    super(code);
    this.name = 'AbcpDiscoveryError';
    this.code = code;
    this.retryable = retryable;
  }
}

export interface AbcpSupplierConfig {
  code: string;
  host: string;
  currency: string;
  login: string;
  passwordMd5: string;
}

export interface AbcpDiscoveryConfig {
  suppliers: AbcpSupplierConfig[];
}

export interface AbcpDiscoveryStatus {
  enabled: boolean;
  configured: boolean;
  providerKey: typeof ABCP_PROVIDER_KEY;
  capability: 'SEARCH';
  supplierCount: number;
}

interface AbcpDiscoveryOptions {
  fetchImpl?: FetchLike;
  now?: () => number;
  /** Per-wholesaler budget for the whole search, body reads included. */
  timeoutMs?: number;
}

function trimmed(env: Record<string, string | undefined>, key: string): string {
  return env[key]?.trim() ?? '';
}

function entries(value: string): string[][] | null {
  if (!value) return null;
  const rows = value.split(',').map((row) => row.trim().split('|'));
  return rows.length <= ABCP_MAX_SUPPLIERS ? rows : null;
}

/**
 * `ABCP_SUPPLIERS` lists `CODE|host|CURRENCY` per wholesaler (not secret) and
 * `ABCP_CREDENTIALS` lists `CODE|login|md5-of-password` for the same codes, so
 * the plain password never sits in the environment. Any malformed, duplicate
 * or unmatched entry disables the whole connector.
 */
export function abcpDiscoveryConfigFromEnv(
  env: Record<string, string | undefined>,
): AbcpDiscoveryConfig | null {
  if (trimmed(env, 'GLOBAL_SOURCING_ABCP_ENABLED').toLowerCase() !== 'true') {
    return null;
  }
  if (trimmed(env, 'SUPPLIER_AUTO_ORDER').toLowerCase() !== 'false') {
    return null;
  }

  const supplierRows = entries(trimmed(env, 'ABCP_SUPPLIERS'));
  const credentialRows = entries(trimmed(env, 'ABCP_CREDENTIALS'));
  if (!supplierRows || !credentialRows) return null;
  if (supplierRows.length !== credentialRows.length) return null;

  const credentials = new Map<string, { login: string; passwordMd5: string }>();
  for (const row of credentialRows) {
    const [code = '', login = '', passwordMd5 = ''] = row.map((part) =>
      part.trim(),
    );
    if (
      row.length !== 3 ||
      !SUPPLIER_CODE.test(code) ||
      credentials.has(code) ||
      !/^[^\s|,]{3,120}$/u.test(login) ||
      !/^[a-f0-9]{32}$/iu.test(passwordMd5)
    ) {
      return null;
    }
    credentials.set(code, { login, passwordMd5: passwordMd5.toLowerCase() });
  }

  const suppliers: AbcpSupplierConfig[] = [];
  for (const row of supplierRows) {
    const [code = '', host = '', currency = ''] = row.map((part) =>
      part.trim(),
    );
    const credential = credentials.get(code);
    if (
      row.length !== 3 ||
      !credential ||
      suppliers.some((supplier) => supplier.code === code) ||
      !ABCP_HOST.test(host) ||
      !SUPPORTED_CURRENCIES.has(currency)
    ) {
      return null;
    }
    suppliers.push({ code, host, currency, ...credential });
  }
  return { suppliers };
}

export function abcpDiscoveryStatusFromEnv(
  env: Record<string, string | undefined>,
): AbcpDiscoveryStatus {
  const config = abcpDiscoveryConfigFromEnv(env);
  return {
    enabled:
      trimmed(env, 'GLOBAL_SOURCING_ABCP_ENABLED').toLowerCase() === 'true',
    configured: config !== null,
    providerKey: ABCP_PROVIDER_KEY,
    capability: 'SEARCH',
    supplierCount: config?.suppliers.length ?? 0,
  };
}

export function abcpDiscoveryStatus(): AbcpDiscoveryStatus {
  return abcpDiscoveryStatusFromEnv(process.env);
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
  const text = safeText(value, maxLength);
  return text && /^[A-Za-z0-9._:-]+$/u.test(text) ? text : null;
}

function safeNumber(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum
    ? number
    : null;
}

function isFlagSet(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function compactPartNumber(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/gu, '');
}

export function normalizeAbcpPartNumber(query: string): string {
  const number = query.normalize('NFKC').trim().toUpperCase();
  if (
    number.length < 3 ||
    number.length > ABCP_PART_NUMBER_MAX_LENGTH ||
    !/^[A-Z0-9][A-Z0-9._/-]*$/u.test(number) ||
    compactPartNumber(number).length < 3
  ) {
    throw new AbcpDiscoveryError('ABCP_CODE_INVALID', false);
  }
  return number;
}

function records(payload: unknown): Record<string, unknown>[] {
  const list = Array.isArray(payload)
    ? payload
    : payload !== null && typeof payload === 'object'
      ? Object.values(payload)
      : null;
  if (!list) throw new AbcpDiscoveryError('ABCP_RESPONSE_INVALID', false);
  return list.filter(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === 'object' && !Array.isArray(item),
  );
}

function hoursEstimate(minimum: number | null, maximum: number | null) {
  if (minimum === null) return null;
  return maximum !== null && maximum > minimum
    ? `${minimum}–${maximum}h`
    : `${minimum}h`;
}

function mapOffer(
  row: Record<string, unknown>,
  supplier: AbcpSupplierConfig,
  wanted: string,
  fetchedAt: string,
): GlobalSourcingCandidate | null {
  const brand = safeText(row.brand, 60);
  const partNumber = safeText(row.numberFix ?? row.number, 80)?.toUpperCase();
  const supplierCode = safeReference(row.supplierCode, 40);
  const rawPrice = safeNumber(row.price, 0.0001, 9_999_999_999.99);
  // Analogs are excluded in the request; anything else is dropped here too.
  if (
    !brand ||
    !partNumber ||
    compactPartNumber(partNumber) !== wanted ||
    !supplierCode ||
    rawPrice === null
  ) {
    return null;
  }

  const description = safeText(row.description, 120);
  const distributor = safeReference(row.distributorCode, 40);
  const stock = safeNumber(row.availability, 0, 9_999_999);
  const weightKg = safeNumber(row.weight, 0, 99_999);
  const deliveryHours = safeNumber(row.deliveryPeriod, 0, 10_000);
  // ABCP uses deadlineReplace instead of the delivery term whenever the
  // maximum term is not filled.
  const deliveryHoursMax = safeNumber(row.deliveryPeriodMax, 1, 10_000);
  const replacementTerm =
    deliveryHoursMax === null ? safeText(row.deadlineReplace, 80) : null;
  const title = (description ? `${brand} · ${description}` : brand).slice(
    0,
    160,
  );
  const externalId = [supplier.code, brand, partNumber, supplierCode]
    .join(':')
    .slice(0, 200);

  return {
    externalId,
    title,
    rawPrice,
    currency: supplier.currency,
    // Negative codes mean an unstated quantity, so availability is unknown.
    availability: stock === null ? null : String(Math.floor(stock)),
    provenance: {
      providerKey: ABCP_PROVIDER_KEY,
      externalId,
      title,
      discoveredAt: fetchedAt,
      itemWebUrl: null,
      listingMarketplaceId: null,
      itemLocationCountry: 'AE',
      condition: isFlagSet(row.isUsed) ? 'USED' : 'NEW',
      buyingOptions: [],
      fitmentEvidence: 'UNVERIFIED',
      supplierOffer: {
        partNumber,
        manufacturer: brand,
        deliveryEstimate:
          replacementTerm ?? hoursEstimate(deliveryHours, deliveryHoursMax),
        weightKg: weightKg ? weightKg : null,
        minimumLot: safeNumber(row.packing, 1, 9_999_999),
        warehouseCode: distributor
          ? `${supplier.code}/${distributor}`
          : supplier.code,
        returnable: isFlagSet(row.noReturn) ? false : null,
      },
    },
  };
}

function errorForStatus(status: number, errorCode: unknown) {
  if (errorCode === 102 || errorCode === 103 || errorCode === 104) {
    return new AbcpDiscoveryError('ABCP_AUTH_FAILED', false);
  }
  // ABCP's nginx answers an unaccepted client with an empty 418.
  if (errorCode === 303 || status === 418) {
    return new AbcpDiscoveryError('ABCP_ACCESS_BLOCKED', false);
  }
  if (status === 429) return new AbcpDiscoveryError('ABCP_RATE_LIMITED', true);
  if (status === 401 || status === 403) {
    return new AbcpDiscoveryError('ABCP_AUTH_FAILED', false);
  }
  if (status >= 400 && status < 500) {
    return new AbcpDiscoveryError('ABCP_REQUEST_REJECTED', false);
  }
  return new AbcpDiscoveryError('ABCP_UNAVAILABLE', true);
}

const invalidResponse = () =>
  new AbcpDiscoveryError('ABCP_RESPONSE_INVALID', false);
const timedOut = () => new AbcpDiscoveryError('ABCP_TIMEOUT', true);

export function createAbcpDiscovery(
  config: AbcpDiscoveryConfig,
  options: AbcpDiscoveryOptions = {},
): GlobalSourcingProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? ABCP_TIMEOUT_MS;

  // The password hash travels in the query string as ABCP requires, so the
  // URL is never logged and redirects are refused.
  async function call(
    supplier: AbcpSupplierConfig,
    operation: 'search/brands' | 'search/articles',
    params: Record<string, string>,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>[]> {
    const url = new URL(`https://${supplier.host}/${operation}`);
    url.searchParams.set('userlogin', supplier.login);
    url.searchParams.set('userpsw', supplier.passwordMd5);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        redirect: 'error',
        signal,
      });
    } catch {
      throw new AbcpDiscoveryError(
        signal.aborted ? 'ABCP_TIMEOUT' : 'ABCP_UNAVAILABLE',
        true,
      );
    }
    if (!response.ok) {
      let errorCode: unknown;
      try {
        const body = await readBoundedJson(response, 64_000, invalidResponse, {
          signal,
          timedOut,
        });
        if (body !== null && typeof body === 'object' && 'errorCode' in body) {
          errorCode = body.errorCode;
        }
      } catch {
        // The HTTP status alone decides the error.
      }
      if (errorCode === ABCP_NOT_FOUND) return [];
      throw errorForStatus(response.status, errorCode);
    }
    return records(
      await readBoundedJson(
        response,
        MAX_PROVIDER_BODY_BYTES,
        invalidResponse,
        {
          signal,
          timedOut,
        },
      ),
    );
  }

  async function searchSupplier(
    supplier: AbcpSupplierConfig,
    number: string,
    fetchedAt: string,
  ): Promise<GlobalSourcingCandidate[]> {
    const signal = AbortSignal.timeout(timeoutMs);
    const wanted = compactPartNumber(number);
    // Online warehouses stay off (ABCP's default, sent explicitly): they are
    // queried live through the wholesaler and may ship from outside the UAE,
    // so results cover the wholesaler's own and price-list stock only.
    const lookup = { number, useOnlineStocks: '0' };
    const brands = (await call(supplier, 'search/brands', lookup, signal))
      .sort(
        (left, right) =>
          Number(isFlagSet(right.availability)) -
          Number(isFlagSet(left.availability)),
      )
      .map((row) => safeText(row.brand, 60))
      .filter((brand): brand is string => brand !== null)
      .filter((brand, index, all) => all.indexOf(brand) === index)
      .slice(0, ABCP_MAX_BRANDS);
    const offers = await Promise.all(
      brands.map((brand) =>
        call(
          supplier,
          'search/articles',
          { ...lookup, brand, withOutAnalogs: '1' },
          signal,
        ),
      ),
    );
    return offers
      .flat()
      .map((row) => mapOffer(row, supplier, wanted, fetchedAt))
      .filter((offer): offer is GlobalSourcingCandidate => offer !== null)
      .sort((left, right) => left.rawPrice - right.rawPrice);
  }

  return {
    key: ABCP_PROVIDER_KEY,
    capabilities: GLOBAL_SOURCING_CAPABILITIES,
    async search(input: GlobalSourcingSearchRequest) {
      const request = normalizeGlobalSourcingSearchRequest(input);
      const number = normalizeAbcpPartNumber(request.query);
      const fetchedAt = new Date(now()).toISOString();
      const settled = await Promise.allSettled(
        config.suppliers.map((supplier) =>
          searchSupplier(supplier, number, fetchedAt),
        ),
      );

      const perSupplier: GlobalSourcingCandidate[][] = [];
      const failures: AbcpDiscoveryError[] = [];
      for (const [index, outcome] of settled.entries()) {
        if (outcome.status === 'fulfilled') {
          perSupplier.push(outcome.value);
          continue;
        }
        const error =
          outcome.reason instanceof AbcpDiscoveryError
            ? outcome.reason
            : invalidResponse();
        failures.push(error);
        console.error('[global-sourcing] ABCP supplier search failed', {
          supplier: config.suppliers[index]?.code,
          code: error.code,
          retryable: error.retryable,
        });
      }
      // One reachable wholesaler is enough; only a total failure is an error.
      if (!perSupplier.length && failures[0]) throw failures[0];

      // Take each supplier's cheapest offers in turn so one wholesaler cannot
      // fill the whole result list.
      const candidates: GlobalSourcingCandidate[] = [];
      for (let rank = 0; candidates.length < request.limit; rank += 1) {
        const round = perSupplier
          .map((offers) => offers[rank])
          .filter((offer): offer is GlobalSourcingCandidate => !!offer);
        if (!round.length) break;
        candidates.push(...round.slice(0, request.limit - candidates.length));
      }
      return {
        providerKey: ABCP_PROVIDER_KEY,
        capability: 'SEARCH',
        fetchedAt,
        candidates,
      };
    },
  };
}

let runtimeProvider:
  { fingerprint: string; provider: GlobalSourcingProvider } | undefined;

export function configuredAbcpDiscovery(): GlobalSourcingProvider | null {
  const config = abcpDiscoveryConfigFromEnv(process.env);
  if (!config) return null;
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(config.suppliers))
    .digest('hex');
  if (!runtimeProvider || runtimeProvider.fingerprint !== fingerprint) {
    runtimeProvider = { fingerprint, provider: createAbcpDiscovery(config) };
  }
  return runtimeProvider.provider;
}
