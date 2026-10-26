import { createHmac, timingSafeEqual } from 'node:crypto';
export interface AuthorizeRequest {
  orderCode: string;
  money: { amount: string; currency: string };
  description: string;
  payer: { firstName: string; lastName: string; email: string; phone: string };
  returnUrl: string;
  notificationUrl: string;
}
export interface AuthorizeResult { redirectUrl: string; externalRef: string | null }

// Server-only Tap transport shared by Supabase Edge Functions and tests.
export interface TapConfig {
  secretKey: string;
  merchantId: string;
  mode: 'sandbox' | 'live';
}

export class TapError extends Error {
  readonly retryable: boolean;
  constructor(code: string, retryable = false) {
    super(code);
    this.name = 'TapError';
    this.retryable = retryable;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function tapConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): TapConfig | null {
  const mode = env.TAP_MODE?.trim();
  const secretKey = env.TAP_SECRET_KEY?.trim();
  const merchantId = env.TAP_MERCHANT_ID?.trim();
  if ((mode !== 'sandbox' && mode !== 'live') || !secretKey || !merchantId) return null;
  const prefix = mode === 'sandbox' ? 'sk_test_' : 'sk_live_';
  if (!secretKey.startsWith(prefix) || secretKey.length <= prefix.length ||
      !/^[A-Za-z0-9_-]+$/.test(merchantId)) return null;
  return { secretKey, merchantId, mode };
}

// SAR only; reject extra decimals instead of rounding a different amount.
export function tapAmount(value: unknown): string {
  if ((typeof value !== 'string' && typeof value !== 'number') ||
      !/^\d+(?:\.\d{1,2})?$/.test(String(value))) throw new TapError('amount_invalid');
  const [whole = '', fraction = ''] = String(value).split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new TapError('amount_invalid');
  return `${Number(whole)}.${fraction.padEnd(2, '0')}`;
}

function httpsUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new TapError('url_invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    throw new TapError('url_invalid');
  return url;
}

export function isTapCheckoutUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = httpsUrl(value);
    return url.hostname === 'checkout.tap.company';
  } catch { return false; }
}

export type TapChargeStatus = 'CAPTURED' | 'PENDING' | 'FAILED' | 'CANCELLED';
export interface ConfirmedTapCharge {
  id: string;
  orderCode: string;
  amount: string;
  currency: 'SAR';
  status: TapChargeStatus;
}

function chargeIdentity(
  payload: unknown, config: TapConfig,
  expected: { orderCode: string; amount: string; currency: string; id?: string },
): Record<string, unknown> {
  const source = record(payload);
  const id = text(source.id);
  if (source.object !== 'charge' || !id || !/^chg_[A-Za-z0-9_-]+$/.test(id) ||
      (expected.id !== undefined && id !== expected.id) ||
      source.live_mode !== (config.mode === 'live') ||
      record(source.merchant).id !== config.merchantId ||
      record(source.reference).order !== expected.orderCode ||
      expected.currency !== 'SAR' || source.currency !== 'SAR' ||
      tapAmount(source.amount) !== tapAmount(expected.amount)) {
    throw new TapError('charge_identity_mismatch', true);
  }
  return source;
}

/** Tap signs a canonical field string, not the raw JSON body. SAR has 2 decimals. */
export function verifyTapChargeWebhook(
  payload: unknown, signature: string | null, config: TapConfig,
): boolean {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  try {
    const p = record(payload), reference = record(p.reference), transaction = record(p.transaction);
    if (p.object !== 'charge' || p.currency !== 'SAR' ||
        p.live_mode !== (config.mode === 'live') ||
        record(p.merchant).id !== config.merchantId ||
        !text(p.id) || !text(p.status) || !text(reference.payment) ||
        (typeof transaction.created !== 'string' && typeof transaction.created !== 'number') ||
        !/^\d+$/.test(String(transaction.created)) ||
        (reference.gateway !== undefined && reference.gateway !== null && typeof reference.gateway !== 'string')) return false;
    const canonical = `x_id${p.id}x_amount${tapAmount(p.amount)}x_currencySAR` +
      `x_gateway_reference${reference.gateway ?? ''}x_payment_reference${reference.payment}` +
      `x_status${p.status}x_created${transaction.created}`;
    const digest = createHmac('sha256', config.secretKey).update(canonical).digest();
    return timingSafeEqual(digest, Buffer.from(signature, 'hex'));
  } catch { return false; }
}

export class TapHostedClient {
  readonly name = 'TAP';
  private readonly config: TapConfig;
  private readonly send: typeof fetch;
  constructor(config: TapConfig, send: typeof fetch = fetch) {
    const validated = tapConfigFromEnv({ TAP_MODE: config.mode,
      TAP_SECRET_KEY: config.secretKey, TAP_MERCHANT_ID: config.merchantId });
    if (!validated) throw new TapError('tap_configuration_invalid');
    this.config = validated;
    this.send = send;
  }

  private async request(path: string, method: 'POST' | 'GET', body?: unknown) {
    try {
      const response = await this.send(`https://api.tap.company/v2/${path}`, {
        method, headers: { accept: 'application/json', 'content-type': 'application/json',
          authorization: `Bearer ${this.config.secretKey}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new TapError(`tap_http_${response.status}`,
        response.status >= 500 || [408, 409, 425, 429].includes(response.status));
      return record(await response.json());
    } catch (error) {
      if (error instanceof TapError) throw error;
      // An uncertain POST may already have created a charge. Caller must keep
      // the persisted attempt pending and reconcile before another attempt.
      throw new TapError('tap_response_unknown', true);
    }
  }

  async authorize(input: AuthorizeRequest): Promise<AuthorizeResult> {
    if (!/^[A-Za-z0-9_-]{3,100}$/.test(input.orderCode)) throw new TapError('reference_invalid');
    if (input.money.currency !== 'SAR') throw new TapError('currency_unsupported');
    const amount = tapAmount(input.money.amount);
    const redirect = httpsUrl(input.returnUrl), post = httpsUrl(input.notificationUrl);
    const phone = input.payer.phone.replace(/[\s()+-]/g, '').replace(/^00966/, '966').replace(/^0(?=5\d{8}$)/, '966');
    if (!/^9665\d{8}$/.test(phone)) throw new TapError('phone_invalid');
    if (!input.payer.firstName.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.payer.email))
      throw new TapError('customer_invalid');
    const payload = await this.request('charges/', 'POST', {
      amount: Number(amount), currency: 'SAR', customer_initiated: true,
      threeDSecure: true, save_card: false, description: input.description,
      reference: { order: input.orderCode, transaction: input.orderCode, idempotent: input.orderCode },
      merchant: { id: this.config.merchantId },
      customer: { first_name: input.payer.firstName, last_name: input.payer.lastName,
        email: input.payer.email, phone: { country_code: '966', number: phone.slice(3) } },
      source: { id: 'src_all' }, redirect: { url: redirect.href }, post: { url: post.href },
    });
    const charge = chargeIdentity(payload, this.config, { orderCode: input.orderCode, amount, currency: 'SAR' });
    const url = record(charge.transaction).url;
    if (charge.status !== 'INITIATED' || !isTapCheckoutUrl(url))
      throw new TapError('checkout_response_unusable', true);
    return { externalRef: charge.id as string, redirectUrl: url };
  }

  async status(expected: { id: string; orderCode: string; amount: string; currency: string }): Promise<ConfirmedTapCharge> {
    if (!/^chg_[A-Za-z0-9_-]+$/.test(expected.id)) throw new TapError('charge_id_invalid');
    const payload = await this.request(`charges/${encodeURIComponent(expected.id)}`, 'GET');
    const p = chargeIdentity(payload, this.config, expected);
    const statuses: Record<string, TapChargeStatus> = {
      CAPTURED: 'CAPTURED', INITIATED: 'PENDING', IN_PROGRESS: 'PENDING',
      FAILED: 'FAILED', DECLINED: 'FAILED', RESTRICTED: 'FAILED', TIMEDOUT: 'FAILED',
      CANCELLED: 'CANCELLED', ABANDONED: 'CANCELLED',
    };
    const status = typeof p.status === 'string' && Object.hasOwn(statuses, p.status) ? statuses[p.status] : undefined;
    if (!status) throw new TapError('charge_status_unknown', true);
    return { id: expected.id, orderCode: expected.orderCode, amount: tapAmount(expected.amount), currency: 'SAR', status };
  }
}
