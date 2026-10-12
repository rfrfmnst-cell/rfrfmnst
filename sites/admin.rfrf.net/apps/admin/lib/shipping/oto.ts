import { createHash } from 'node:crypto';
import {
  OTO_PROVIDER_KEY,
  hasControlCharacter,
  opaqueToken,
  otoFulfillmentConfigFromEnv,
  type OtoFulfillmentConfig,
} from './oto-config.ts';
import {
  parseBoundedJson,
  safeFiniteNumber,
  safeText,
  toRecord,
} from './oto-response.ts';

export {
  OTO_PROVIDER_KEY,
  otoFulfillmentConfigFromEnv,
  otoFulfillmentStatus,
  otoFulfillmentStatusFromEnv,
  type OtoFulfillmentConfig,
  type OtoFulfillmentStatus,
} from './oto-config.ts';

export const OTO_API_BASE_URL = 'https://api.tryoto.com/rest/v2';
export const OTO_REFRESH_URL = `${OTO_API_BASE_URL}/refreshToken`;
export const OTO_RATES_URL = `${OTO_API_BASE_URL}/checkOTODeliveryFee`;
export const OTO_TIMEOUT_MS = 10_000;
const OTO_MAX_PROVIDER_RATE_OPTIONS = 100;

const GCC_COUNTRIES = new Set(['AE', 'BH', 'KW', 'OM', 'QA', 'SA']);
const OTO_SERVICE_TYPES = new Set([
  'express',
  'sameDay',
  'fastDelivery',
  'coldDelivery',
  'heavyAndBulky',
  'electronicAndHeavy',
]);

type FetchLike = typeof fetch;
export type OtoFulfillmentErrorCode =
  | 'OTO_REQUEST_INVALID'
  | 'OTO_TIMEOUT'
  | 'OTO_UNAVAILABLE'
  | 'OTO_AUTH_FAILED'
  | 'OTO_RATE_LIMITED'
  | 'OTO_REQUEST_REJECTED'
  | 'OTO_RESPONSE_INVALID';

export class OtoFulfillmentError extends Error {
  readonly code: OtoFulfillmentErrorCode;
  readonly retryable: boolean;

  constructor(code: OtoFulfillmentErrorCode, retryable: boolean) {
    super(code);
    this.name = 'OtoFulfillmentError';
    this.code = code;
    this.retryable = retryable;
  }
}

export interface OtoRateRequest {
  originCity: string;
  destinationCity: string;
  weightKg: number;
  originCountry?: string;
  destinationCountry?: string;
  currency?: string;
  packageCount?: number;
  totalDue?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  serviceType?: string;
}

export interface OtoDeliveryRate {
  deliveryOptionId: number;
  deliveryCompanyName: string;
  deliveryOptionName: string | null;
  serviceType: string | null;
  pickupDropoff: string | null;
  price: number;
  currency: string;
  averageDeliveryTime: string | null;
  maxFreeWeightKg: number | null;
  returnFee: number | null;
  maxOrderValue: number | null;
  maxCodValue: number | null;
  codCharge: number | null;
}

export interface OtoFulfillmentAdapter {
  readonly key: typeof OTO_PROVIDER_KEY;
  readonly capabilities: readonly ['RATES'];
  getRates(request: OtoRateRequest): Promise<OtoDeliveryRate[]>;
}

interface OtoFulfillmentOptions {
  fetchImpl?: FetchLike;
  now?: () => number;
}

interface OtoProviderRateRequest {
  originCity: string;
  destinationCity: string;
  originCountry: string;
  destinationCountry: string;
  weight: number;
  currency: string;
  packageCount?: number;
  totalDue?: number;
  length?: number;
  width?: number;
  height?: number;
  serviceType?: string;
}

interface CachedAccessToken {
  value: string;
  expiresAt: number;
}

function normalizedCountry(
  value: string | undefined,
  fallback: string,
): string {
  const candidate = value ?? fallback;
  if (typeof candidate !== 'string') {
    throw new OtoFulfillmentError('OTO_REQUEST_INVALID', false);
  }
  const country = candidate.trim().toUpperCase();
  if (!GCC_COUNTRIES.has(country)) {
    throw new OtoFulfillmentError('OTO_REQUEST_INVALID', false);
  }
  return country;
}

function normalizedCurrency(value: string | undefined): string {
  const candidate = value ?? 'SAR';
  if (typeof candidate !== 'string') {
    throw new OtoFulfillmentError('OTO_REQUEST_INVALID', false);
  }
  const currency = candidate.trim().toUpperCase();
  if (currency !== 'SAR') {
    throw new OtoFulfillmentError('OTO_REQUEST_INVALID', false);
  }
  return currency;
}

function normalizedPositiveNumber(value: unknown, maximum: number): number {
  const number = safeFiniteNumber(value, Number.EPSILON, maximum);
  if (number === null) {
    throw new OtoFulfillmentError('OTO_REQUEST_INVALID', false);
  }
  return number;
}

function normalizedOptionalPositiveNumber(
  value: unknown,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  return normalizedPositiveNumber(value, maximum);
}

function normalizedOptionalNonNegativeNumber(
  value: unknown,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  const number = safeFiniteNumber(value, 0, maximum);
  if (number === null) {
    throw new OtoFulfillmentError('OTO_REQUEST_INVALID', false);
  }
  return number;
}

function normalizedPackageCount(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const count = safeFiniteNumber(value, 1, 1_000);
  if (count === null || !Number.isInteger(count)) {
    throw new OtoFulfillmentError('OTO_REQUEST_INVALID', false);
  }
  return count;
}

function normalizedCity(value: unknown): string {
  if (typeof value !== 'string' || hasControlCharacter(value)) {
    throw new OtoFulfillmentError('OTO_REQUEST_INVALID', false);
  }
  const city = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const length = [...city].length;
  if (length < 2 || length > 100) {
    throw new OtoFulfillmentError('OTO_REQUEST_INVALID', false);
  }
  return city;
}

function rateRequestBody(input: OtoRateRequest): OtoProviderRateRequest {
  const originCity = normalizedCity(input.originCity);
  const destinationCity = normalizedCity(input.destinationCity);
  const serviceType = input.serviceType?.trim();
  if (serviceType && !OTO_SERVICE_TYPES.has(serviceType)) {
    throw new OtoFulfillmentError('OTO_REQUEST_INVALID', false);
  }
  const packageCount = normalizedPackageCount(input.packageCount);
  const totalDue = normalizedOptionalNonNegativeNumber(
    input.totalDue,
    9_999_999_999.99,
  );
  const length = normalizedOptionalPositiveNumber(input.lengthCm, 9_999);
  const width = normalizedOptionalPositiveNumber(input.widthCm, 9_999);
  const height = normalizedOptionalPositiveNumber(input.heightCm, 9_999);
  return {
    originCity,
    destinationCity,
    originCountry: normalizedCountry(input.originCountry, 'SA'),
    destinationCountry: normalizedCountry(input.destinationCountry, 'SA'),
    weight: normalizedPositiveNumber(input.weightKg, 99_999),
    currency: normalizedCurrency(input.currency),
    ...(packageCount === undefined ? {} : { packageCount }),
    ...(totalDue === undefined ? {} : { totalDue }),
    ...(length === undefined ? {} : { length }),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(serviceType ? { serviceType } : {}),
  };
}

function errorForStatus(status: number): OtoFulfillmentError {
  if (status === 429) return new OtoFulfillmentError('OTO_RATE_LIMITED', true);
  if (status === 401 || status === 403) {
    return new OtoFulfillmentError('OTO_AUTH_FAILED', false);
  }
  if (status >= 400 && status < 500) {
    return new OtoFulfillmentError('OTO_REQUEST_REJECTED', false);
  }
  return new OtoFulfillmentError('OTO_UNAVAILABLE', true);
}

function invalidResponse(): OtoFulfillmentError {
  return new OtoFulfillmentError('OTO_RESPONSE_INVALID', false);
}

function normalizedNullableText(
  value: unknown,
  maximum: number,
): string | null {
  return value === null || value === undefined
    ? null
    : safeText(value, maximum);
}

function normalizedNullableNumber(
  value: unknown,
  maximum: number,
): number | null {
  return value === null || value === undefined
    ? null
    : safeFiniteNumber(value, 0, maximum);
}

function mapDeliveryRate(
  value: unknown,
  expectedCurrency: string,
): OtoDeliveryRate | null {
  const record = toRecord(value);
  if (!record) return null;
  const deliveryOptionId = safeFiniteNumber(
    record.deliveryOptionId,
    1,
    9_999_999_999,
  );
  const deliveryCompanyName = safeText(record.deliveryCompanyName, 120);
  const price = safeFiniteNumber(record.price, 0, 9_999_999_999.99);
  const responseCurrency =
    record.currency === null || record.currency === undefined
      ? null
      : safeText(record.currency, 3);
  if (
    deliveryOptionId === null ||
    !Number.isInteger(deliveryOptionId) ||
    !deliveryCompanyName ||
    price === null ||
    (record.currency !== null &&
      record.currency !== undefined &&
      responseCurrency !== expectedCurrency)
  ) {
    return null;
  }
  return {
    deliveryOptionId,
    deliveryCompanyName,
    deliveryOptionName: normalizedNullableText(record.deliveryOptionName, 160),
    serviceType: normalizedNullableText(record.serviceType, 80),
    pickupDropoff: normalizedNullableText(record.pickupDropoff, 80),
    price,
    currency: expectedCurrency,
    averageDeliveryTime: normalizedNullableText(record.avgDeliveryTime, 120),
    maxFreeWeightKg: normalizedNullableNumber(record.maxFreeWeight, 99_999),
    returnFee: normalizedNullableNumber(record.returnFee, 9_999_999_999.99),
    maxOrderValue: normalizedNullableNumber(
      record.maxOrderValue,
      9_999_999_999.99,
    ),
    maxCodValue: normalizedNullableNumber(record.maxCODValue, 9_999_999_999.99),
    codCharge: normalizedNullableNumber(record.codCharge, 9_999_999_999.99),
  };
}

function tokenFromPayload(payload: unknown): {
  value: string;
  expiresInMs: number;
} {
  const record = toRecord(payload);
  const value = opaqueToken(
    record?.access_token ?? record?.accessToken ?? record?.token,
  );
  const expiresIn =
    safeFiniteNumber(record?.expires_in ?? record?.expiresIn, 60, 86_400) ??
    300;
  if (!value) throw invalidResponse();
  return { value, expiresInMs: expiresIn * 1_000 };
}

async function discardResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The provider status is still authoritative if transport cleanup fails.
  }
}

export function createOtoFulfillment(
  config: OtoFulfillmentConfig,
  options: OtoFulfillmentOptions = {},
): OtoFulfillmentAdapter {
  const refreshToken = opaqueToken(config.refreshToken);
  if (!refreshToken) {
    throw new OtoFulfillmentError('OTO_AUTH_FAILED', false);
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  let cachedAccessToken: CachedAccessToken | null = null;
  let refreshInFlight: Promise<string> | null = null;

  async function providerFetch(
    url: typeof OTO_REFRESH_URL | typeof OTO_RATES_URL,
    init: RequestInit,
  ): Promise<Response> {
    const signal = AbortSignal.timeout(OTO_TIMEOUT_MS);
    try {
      return await fetchImpl(url, {
        ...init,
        cache: 'no-store',
        redirect: 'error',
        signal,
      });
    } catch {
      throw new OtoFulfillmentError(
        signal.aborted ? 'OTO_TIMEOUT' : 'OTO_UNAVAILABLE',
        true,
      );
    }
  }

  async function refreshAccessToken(): Promise<string> {
    if (refreshInFlight) return refreshInFlight;
    const refresh = (async () => {
      const response = await providerFetch(OTO_REFRESH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!response.ok) {
        await discardResponse(response);
        throw errorForStatus(response.status);
      }
      const token = tokenFromPayload(
        await parseBoundedJson(response, invalidResponse),
      );
      cachedAccessToken = {
        value: token.value,
        expiresAt: now() + Math.max(token.expiresInMs - 60_000, 0),
      };
      return token.value;
    })();
    refreshInFlight = refresh;
    try {
      return await refresh;
    } finally {
      if (refreshInFlight === refresh) refreshInFlight = null;
    }
  }

  async function accessToken(): Promise<string> {
    if (
      cachedAccessToken &&
      cachedAccessToken.expiresAt > now() &&
      opaqueToken(cachedAccessToken.value)
    ) {
      return cachedAccessToken.value;
    }
    return refreshAccessToken();
  }

  async function tokenAfterRejection(rejected: string): Promise<string> {
    if (cachedAccessToken?.value === rejected) cachedAccessToken = null;
    if (
      cachedAccessToken &&
      cachedAccessToken.value !== rejected &&
      cachedAccessToken.expiresAt > now() &&
      opaqueToken(cachedAccessToken.value)
    ) {
      return cachedAccessToken.value;
    }
    return refreshAccessToken();
  }

  function requestRates(
    token: string,
    body: OtoProviderRateRequest,
  ): Promise<Response> {
    return providerFetch(OTO_RATES_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  return {
    key: OTO_PROVIDER_KEY,
    capabilities: ['RATES'],
    async getRates(input) {
      const body = rateRequestBody(input);
      let token = await accessToken();
      let response = await requestRates(token, body);
      if (response.status === 401 || response.status === 403) {
        await discardResponse(response);
        token = await tokenAfterRejection(token);
        response = await requestRates(token, body);
      }
      if (
        (response.status === 401 || response.status === 403) &&
        cachedAccessToken?.value === token
      ) {
        cachedAccessToken = null;
      }
      if (!response.ok) {
        await discardResponse(response);
        throw errorForStatus(response.status);
      }

      const payload = toRecord(
        await parseBoundedJson(response, invalidResponse),
      );
      if (
        !payload ||
        payload.success !== true ||
        !Array.isArray(payload.deliveryCompany) ||
        payload.deliveryCompany.length > OTO_MAX_PROVIDER_RATE_OPTIONS
      ) {
        throw invalidResponse();
      }
      const rates: OtoDeliveryRate[] = [];
      for (const option of payload.deliveryCompany) {
        const rate = mapDeliveryRate(option, body.currency);
        if (rate) rates.push(rate);
      }
      if (payload.deliveryCompany.length > 0 && rates.length === 0) {
        throw invalidResponse();
      }
      return rates.sort((left, right) => left.price - right.price).slice(0, 50);
    },
  };
}

let runtimeAdapter:
  { fingerprint: string; adapter: OtoFulfillmentAdapter } | undefined;

export function configuredOtoFulfillment(): OtoFulfillmentAdapter | null {
  const config = otoFulfillmentConfigFromEnv(process.env);
  if (!config) return null;
  const fingerprint = createHash('sha256')
    .update(config.refreshToken)
    .digest('hex');
  if (!runtimeAdapter || runtimeAdapter.fingerprint !== fingerprint) {
    runtimeAdapter = { fingerprint, adapter: createOtoFulfillment(config) };
  }
  return runtimeAdapter.adapter;
}
