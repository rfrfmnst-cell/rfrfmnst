import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  PaymentProviderError,
  type AuthorizeRequest,
  type AuthorizeResult,
  type CaptureRequest,
  type PaymentOperationResult,
  type PaymentProvider,
  type WebhookParseResult,
} from '@rafraf/shared/payments/payment-provider';

const PROJECT_URL = 'https://gfxnwfjjpxmzvnylushd.supabase.co';
type Env = Record<string, string | undefined>;
export interface TapBridgeConfig {
  projectUrl: string;
  serviceKey: string;
  mode: 'sandbox' | 'live';
}
export function tapBridgeConfig(
  env: Env = process.env,
): TapBridgeConfig | null {
  const projectUrl = env.SUPABASE_URL?.replace(/\/$/, ''),
    serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (
    projectUrl !== PROJECT_URL ||
    !serviceKey ||
    !['sandbox', 'live'].includes(env.TAP_MODE ?? '')
  )
    return null;
  return { projectUrl, serviceKey, mode: env.TAP_MODE as 'sandbox' | 'live' };
}
export function verifyTapBridgeNotification(
  raw: string,
  timestamp: string | null,
  signature: string | null,
  key: string,
  now = Date.now(),
): boolean {
  if (
    !key ||
    !timestamp ||
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp)) > 300000 ||
    !signature ||
    !/^[a-f0-9]{64}$/i.test(signature)
  )
    return false;
  const digest = createHmac('sha256', key)
    .update(`${timestamp}.${raw}`)
    .digest();
  return timingSafeEqual(digest, Buffer.from(signature, 'hex'));
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function redirectAllowed(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'checkout.tap.company' &&
      !url.username &&
      !url.password &&
      !url.port
    );
  } catch {
    return false;
  }
}
export { redirectAllowed as isTapBridgeRedirect };

export class TapSupabaseProvider implements PaymentProvider {
  readonly name = 'TAP';
  private readonly config: TapBridgeConfig;
  private readonly send: typeof fetch;
  constructor(config: TapBridgeConfig, send: typeof fetch = fetch) {
    this.config = config;
    this.send = send;
  }
  private async call(
    path: string,
    payload: unknown,
  ): Promise<Record<string, unknown>> {
    try {
      const response = await this.send(
        `${this.config.projectUrl}/functions/v1/rafraf-tap/${path}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-rafraf-service-key': this.config.serviceKey,
          },
          body: JSON.stringify(payload),
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(45000),
        },
      );
      if (!response.ok)
        throw new PaymentProviderError(
          'tap',
          `tap_bridge_http_${response.status}`,
          ![400, 401, 403, 422].includes(response.status),
        );
      return object(await response.json());
    } catch (error) {
      if (error instanceof PaymentProviderError) throw error;
      throw new PaymentProviderError('tap', 'tap_bridge_unreachable', true);
    }
  }
  async ready(): Promise<boolean> {
    const value = await this.call('configuration', {});
    return (
      value.configured === true &&
      value.checkoutEnabled === true &&
      value.mode === this.config.mode
    );
  }
  async authorize(
    request: AuthorizeRequest,
    order?: { id: string; code: string },
  ): Promise<AuthorizeResult> {
    if (
      !order ||
      !/^\d+\.\d{2}$/.test(request.money.amount) ||
      request.money.currency !== 'SAR'
    )
      throw new PaymentProviderError('tap', 'order_context_invalid');
    const [whole = '', fraction = ''] = request.money.amount.split('.');
    const amountMinor = Number(whole) * 100 + Number(fraction);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
      throw new PaymentProviderError('tap', 'amount_invalid');
    const result = await this.call('checkout', {
      attemptId: request.orderCode,
      orderId: order.id,
      orderCode: order.code,
      amountMinor,
      currency: 'SAR',
      payer: request.payer,
    });
    if (
      !redirectAllowed(result.redirectUrl) ||
      typeof result.externalRef !== 'string' ||
      !/^chg_[A-Za-z0-9_-]+$/.test(result.externalRef)
    )
      throw new PaymentProviderError('tap', 'checkout_result_unusable', true);
    return { redirectUrl: result.redirectUrl, externalRef: result.externalRef };
  }
  async status(
    orderCode: string,
    externalRef: string,
    amount: string,
    currency: string,
  ): Promise<PaymentOperationResult> {
    const result = await this.call('status', {
      attemptId: orderCode,
      externalRef,
    });
    const [whole = '', fraction = ''] = amount.split('.');
    const expectedMinor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (
      !/^\d+\.\d{2}$/.test(amount) ||
      !Number.isSafeInteger(expectedMinor) ||
      expectedMinor <= 0 ||
      result.attemptId !== orderCode ||
      result.externalRef !== externalRef ||
      result.amountMinor !== expectedMinor ||
      currency !== 'SAR' ||
      result.currency !== currency ||
      result.mode !== this.config.mode
    )
      throw new PaymentProviderError('tap', 'status_identity_mismatch', true);
    const outcomes = {
      CAPTURED: 'CAPTURED',
      FAILED: 'DECLINED',
      CANCELLED: 'CANCELLED',
      PENDING: 'PENDING',
    } as const;
    if (
      typeof result.outcome !== 'string' ||
      !Object.hasOwn(outcomes, result.outcome)
    )
      throw new PaymentProviderError('tap', 'status_unusable', true);
    return {
      outcome: outcomes[result.outcome as keyof typeof outcomes],
      externalRef,
      declineReason: null,
      refundEligibility: 'UNKNOWN',
    };
  }
  capture(request: CaptureRequest): Promise<PaymentOperationResult> {
    return this.status(
      request.orderCode,
      request.externalRef,
      request.money.amount,
      request.money.currency,
    );
  }
  async refund(): Promise<PaymentOperationResult> {
    // No guessed refund contract. Sandbox checkout remains isolated from live
    // intake until refund/reconciliation support passes its acceptance tests.
    throw new PaymentProviderError('tap', 'tap_refund_not_enabled', true);
  }
  parseWebhook(payload: unknown): WebhookParseResult {
    const value = object(payload);
    return {
      verified: false,
      orderCode: typeof value.orderCode === 'string' ? value.orderCode : null,
      externalRef:
        typeof value.externalRef === 'string' ? value.externalRef : null,
      outcome: null,
      declineReason: null,
    };
  }
}
export function tapSupabaseProviderFromEnv(
  env: Env = process.env,
): TapSupabaseProvider | null {
  const config = tapBridgeConfig(env);
  return config ? new TapSupabaseProvider(config) : null;
}
