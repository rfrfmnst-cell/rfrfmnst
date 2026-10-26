import { createHash } from 'node:crypto';
import {
  opaqueToken,
  otoFulfillmentConfigFromEnv,
  otoWebhookConfigFromEnv,
} from './oto-config.ts';
import {
  parseBoundedJson,
  safeFiniteNumber,
  safeText,
  toRecord,
} from './oto-response.ts';

export const OTO_OPERATIONAL_BASE_URL = 'https://api.tryoto.com/rest/v2';
export const OTO_CREATE_ORDER_URL = `${OTO_OPERATIONAL_BASE_URL}/createOrder`;
export const OTO_CREATE_SHIPMENT_URL = `${OTO_OPERATIONAL_BASE_URL}/createShipment`;
export const OTO_ORDER_DETAILS_URL = `${OTO_OPERATIONAL_BASE_URL}/orderDetails`;
export const OTO_PRINT_URL = `${OTO_OPERATIONAL_BASE_URL}/print`;
const OTO_REFRESH_URL = `${OTO_OPERATIONAL_BASE_URL}/refreshToken`;
const OTO_TIMEOUT_MS = 10_000;

type FetchLike = typeof fetch;

export interface OtoOperationalConfig {
  refreshToken: string;
}

export interface OtoOrderParty {
  name: string;
  mobile: string;
  email?: string;
  address: string;
  district?: string;
  city: string;
  country: string;
  postcode?: string;
  refID?: string;
}

export interface OtoOrderItem {
  name: string;
  price: number;
  rowTotal?: number;
  taxAmount?: number;
  quantity: number;
  sku: string;
}

export interface OtoCreateOrderRequest {
  orderId: string;
  pickupLocationCode?: string;
  deliveryOptionId?: number;
  amount: number;
  currency: 'SAR';
  packageCount: number;
  packageWeight: number;
  boxWidth?: number;
  boxLength?: number;
  boxHeight?: number;
  customer: OtoOrderParty;
  items: readonly OtoOrderItem[];
}

export interface OtoProviderWriteResult {
  orderId: string;
  otoId: string;
}

export interface OtoOperationalAdapter {
  readonly key: 'OTO';
  readonly capabilities: readonly [
    'CREATE_ORDER',
    'CREATE_SHIPMENT',
    'AWB',
    'TRACK',
  ];
  createOrder(request: OtoCreateOrderRequest): Promise<OtoProviderWriteResult>;
  createShipment(
    orderId: string,
    deliveryOptionId: number,
  ): Promise<OtoProviderWriteResult>;
  getOrderDetails(orderId: string): Promise<Record<string, unknown>>;
  fetchAwb(orderId: string): Promise<Response>;
}

export class OtoOperationalError extends Error {
  readonly code:
    | 'OTO_OPERATIONAL_CONFIG_MISSING'
    | 'OTO_OPERATIONAL_REQUEST_INVALID'
    | 'OTO_OPERATIONAL_AUTH_FAILED'
    | 'OTO_OPERATIONAL_REJECTED'
    | 'OTO_OPERATIONAL_UNAVAILABLE'
    | 'OTO_OPERATIONAL_RESPONSE_INVALID';
  readonly retryable: boolean;

  constructor(code: OtoOperationalError['code'], retryable = false) {
    super(code);
    this.name = 'OtoOperationalError';
    this.code = code;
    this.retryable = retryable;
  }
}

function invalidRequest(): never {
  throw new OtoOperationalError('OTO_OPERATIONAL_REQUEST_INVALID');
}

function normalizedText(value: unknown, max: number): string {
  const result = safeText(value, max);
  if (!result) invalidRequest();
  return result;
}

function normalizedOrderId(value: unknown): string {
  const orderId = normalizedText(value, 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{2,99}$/u.test(orderId)) invalidRequest();
  return orderId;
}

function normalizedPositive(value: unknown, max: number): number {
  const result = safeFiniteNumber(value, Number.EPSILON, max);
  if (result === null) invalidRequest();
  return result;
}

function normalizedCount(value: unknown): number {
  const count = safeFiniteNumber(value, 1, 1_000);
  if (count === null || !Number.isInteger(count)) invalidRequest();
  return count;
}

function normalizedParty(party: OtoOrderParty): OtoOrderParty {
  const email = party.email?.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) invalidRequest();
  const country = normalizedText(party.country, 3).toUpperCase();
  if (!/^[A-Z]{2}$/u.test(country)) invalidRequest();
  return {
    name: normalizedText(party.name, 160),
    mobile: normalizedText(party.mobile, 32),
    ...(email ? { email } : {}),
    address: normalizedText(party.address, 500),
    ...(party.district
      ? { district: normalizedText(party.district, 160) }
      : {}),
    city: normalizedText(party.city, 100),
    country,
    ...(party.postcode ? { postcode: normalizedText(party.postcode, 32) } : {}),
    ...(party.refID ? { refID: normalizedText(party.refID, 100) } : {}),
  };
}

export function buildOtoOrderDraft(
  input: OtoCreateOrderRequest,
): Record<string, unknown> {
  if (
    input.currency !== 'SAR' ||
    input.items.length < 1 ||
    input.items.length > 100
  ) {
    invalidRequest();
  }
  const amount = normalizedPositive(input.amount, 9_999_999_999.99);
  const items = input.items.map((item) => {
    const quantity = normalizedPositive(item.quantity, 100_000);
    const price = normalizedPositive(item.price, 9_999_999_999.99);
    return {
      name: normalizedText(item.name, 240),
      price,
      quantity,
      sku: normalizedText(item.sku, 120),
      ...(item.rowTotal === undefined
        ? {}
        : { rowTotal: normalizedPositive(item.rowTotal, 9_999_999_999.99) }),
      ...(item.taxAmount === undefined
        ? {}
        : { taxAmount: normalizedPositive(item.taxAmount, 9_999_999_999.99) }),
    };
  });
  return {
    orderId: normalizedOrderId(input.orderId),
    createShipment: false,
    payment_method: 'paid',
    amount,
    amount_due: 0,
    currency: 'SAR',
    packageCount: normalizedCount(input.packageCount),
    packageWeight: normalizedPositive(input.packageWeight, 99_999),
    ...(input.pickupLocationCode
      ? { pickupLocationCode: normalizedText(input.pickupLocationCode, 100) }
      : {}),
    ...(input.deliveryOptionId === undefined
      ? {}
      : {
          deliveryOptionId: normalizedCount(input.deliveryOptionId),
        }),
    ...(input.boxWidth === undefined
      ? {}
      : { boxWidth: normalizedPositive(input.boxWidth, 9_999) }),
    ...(input.boxLength === undefined
      ? {}
      : { boxLength: normalizedPositive(input.boxLength, 9_999) }),
    ...(input.boxHeight === undefined
      ? {}
      : { boxHeight: normalizedPositive(input.boxHeight, 9_999) }),
    customer: normalizedParty(input.customer),
    items,
  };
}

function providerResult(
  payload: unknown,
  orderId: string,
): OtoProviderWriteResult {
  const record = toRecord(payload);
  const otoId =
    safeText(record?.otoId, 100) ??
    safeFiniteNumber(record?.otoId, 1, Number.MAX_SAFE_INTEGER)?.toString() ??
    null;
  if (record?.success !== true || !otoId) {
    throw new OtoOperationalError('OTO_OPERATIONAL_RESPONSE_INVALID');
  }
  return { orderId, otoId };
}

function statusError(status: number): OtoOperationalError {
  if (status === 401 || status === 403) {
    return new OtoOperationalError('OTO_OPERATIONAL_AUTH_FAILED');
  }
  if (status >= 400 && status < 500) {
    return new OtoOperationalError('OTO_OPERATIONAL_REJECTED');
  }
  return new OtoOperationalError('OTO_OPERATIONAL_UNAVAILABLE', true);
}

export function otoOperationalConfigFromEnv(
  env: Record<string, string | undefined>,
): OtoOperationalConfig | null {
  const base = otoFulfillmentConfigFromEnv(env);
  return base && otoWebhookConfigFromEnv(env)
    ? { refreshToken: base.refreshToken }
    : null;
}

export function createOtoOperationalAdapter(
  config: OtoOperationalConfig,
  options: { fetchImpl?: FetchLike; now?: () => number } = {},
): OtoOperationalAdapter {
  const refreshToken = opaqueToken(config.refreshToken);
  if (!refreshToken) {
    throw new OtoOperationalError('OTO_OPERATIONAL_CONFIG_MISSING');
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  let token: { value: string; expiresAt: number } | null = null;
  let refreshInFlight: Promise<string> | null = null;

  async function providerFetch(
    url: string,
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
      throw new OtoOperationalError('OTO_OPERATIONAL_UNAVAILABLE', true);
    }
  }

  async function accessToken(force = false): Promise<string> {
    if (!force && token && token.expiresAt > now()) return token.value;
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
      if (!response.ok) throw statusError(response.status);
      const payload = toRecord(
        await parseBoundedJson(
          response,
          () => new OtoOperationalError('OTO_OPERATIONAL_RESPONSE_INVALID'),
        ),
      );
      const value = opaqueToken(
        payload?.access_token ?? payload?.accessToken ?? payload?.token,
      );
      const expiresIn =
        safeFiniteNumber(
          payload?.expires_in ?? payload?.expiresIn,
          60,
          86_400,
        ) ?? 300;
      if (!value) {
        throw new OtoOperationalError('OTO_OPERATIONAL_RESPONSE_INVALID');
      }
      token = {
        value,
        expiresAt: now() + Math.max(expiresIn * 1_000 - 60_000, 0),
      };
      return value;
    })();
    refreshInFlight = refresh;
    try {
      return await refresh;
    } finally {
      if (refreshInFlight === refresh) refreshInFlight = null;
    }
  }

  async function authorized(url: string, init: RequestInit): Promise<Response> {
    let current = await accessToken();
    let response = await providerFetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${current}` },
    });
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => undefined);
      token = null;
      current = await accessToken(true);
      response = await providerFetch(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${current}` },
      });
    }
    return response;
  }

  async function jsonRequest(url: string, init: RequestInit): Promise<unknown> {
    const response = await authorized(url, init);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw statusError(response.status);
    }
    return parseBoundedJson(
      response,
      () => new OtoOperationalError('OTO_OPERATIONAL_RESPONSE_INVALID'),
    );
  }

  return {
    key: 'OTO',
    capabilities: ['CREATE_ORDER', 'CREATE_SHIPMENT', 'AWB', 'TRACK'],
    async createOrder(request) {
      const body = buildOtoOrderDraft(request);
      const orderId = body.orderId as string;
      const payload = await jsonRequest(OTO_CREATE_ORDER_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      return providerResult(payload, orderId);
    },
    async createShipment(orderIdInput, deliveryOptionIdInput) {
      const orderId = normalizedOrderId(orderIdInput);
      const deliveryOptionId = normalizedCount(deliveryOptionIdInput);
      const payload = await jsonRequest(OTO_CREATE_SHIPMENT_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ orderId, deliveryOptionId }),
      });
      return providerResult(payload, orderId);
    },
    async getOrderDetails(orderIdInput) {
      const orderId = normalizedOrderId(orderIdInput);
      const payload = toRecord(
        await jsonRequest(
          `${OTO_ORDER_DETAILS_URL}?orderId=${encodeURIComponent(orderId)}`,
          { method: 'GET', headers: { Accept: 'application/json' } },
        ),
      );
      if (!payload) {
        throw new OtoOperationalError('OTO_OPERATIONAL_RESPONSE_INVALID');
      }
      return payload;
    },
    async fetchAwb(orderIdInput) {
      const orderId = normalizedOrderId(orderIdInput);
      const response = await authorized(
        `${OTO_PRINT_URL}/${encodeURIComponent(orderId)}`,
        {
          method: 'GET',
          headers: { Accept: 'application/pdf,application/json' },
        },
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw statusError(response.status);
      }
      return response;
    },
  };
}

let runtime:
  { fingerprint: string; adapter: OtoOperationalAdapter } | undefined;

export function configuredOtoOperationalAdapter(): OtoOperationalAdapter | null {
  const config = otoOperationalConfigFromEnv(process.env);
  if (!config) return null;
  const fingerprint = createHash('sha256')
    .update(config.refreshToken)
    .digest('hex');
  if (!runtime || runtime.fingerprint !== fingerprint) {
    runtime = { fingerprint, adapter: createOtoOperationalAdapter(config) };
  }
  return runtime.adapter;
}
