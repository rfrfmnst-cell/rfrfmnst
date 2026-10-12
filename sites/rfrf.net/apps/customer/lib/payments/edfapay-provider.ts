import { normalizeEdfaPayApiBaseUrl } from '@rafraf/shared/payments/edfapay-endpoint';
import {
  asEdfaPayRecord,
  edfaPayRootCodeSucceeded,
  outcomeFromEdfaPayStatus,
  parseEdfaPayAcceptedRefund,
  parseEdfaPayTransactionStatus,
  readEdfaPayText,
} from '@rafraf/shared/payments/edfapay-hosted';
import type {
  AuthorizeRequest,
  AuthorizeResult,
  CaptureRequest,
  PaymentOperationResult,
  PaymentProvider,
  RefundRequest,
  WebhookParseResult,
} from '@rafraf/shared/payments/payment-provider';
import { PaymentProviderError } from '@rafraf/shared/payments/payment-provider';

export { outcomeFromEdfaPayStatus } from '@rafraf/shared/payments/edfapay-hosted';

/**
 * EdfaPay Hosted Checkout v1 adapter.
 *
 * The current provider contract uses server-side `X-API-KEY` authentication,
 * JSON requests, and a hosted checkout URL. Card data never crosses Rafraf.
 * An incoming webhook remains a wake-up signal only: its identifiers are used
 * to query EdfaPay's authenticated status endpoint before any local state or
 * escrow entry is changed.
 */

const REQUEST_TIMEOUT_MS = 20_000;

export interface EdfaPayConfig {
  apiKey: string;
  baseUrl: string;
}

export function edfaPayConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): EdfaPayConfig | null {
  const apiKey = env.EDFAPAY_API_KEY?.trim();
  const baseUrl = normalizeEdfaPayApiBaseUrl(env.EDFAPAY_BASE_URL);
  if (!apiKey || !baseUrl) return null;
  return { apiKey, baseUrl };
}

/** The provider accepts decimals; normalize to a two-decimal string first. */
export function formatEdfaPayAmount(amount: string | number): string {
  const numeric = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new PaymentProviderError('edfapay', 'amount_invalid');
  }
  return numeric.toFixed(2);
}

export class EdfaPayProvider implements PaymentProvider {
  readonly name = 'EDFAPAY';
  private readonly config: EdfaPayConfig;

  constructor(config: EdfaPayConfig) {
    this.config = config;
  }

  private async request(
    path: string,
    init: Omit<RequestInit, 'signal' | 'cache'>,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        ...init,
        headers: {
          accept: 'application/json',
          'X-API-KEY': this.config.apiKey,
          ...init.headers,
        },
        signal: controller.signal,
        cache: 'no-store',
        redirect: 'error',
      });
    } catch {
      throw new PaymentProviderError('edfapay', 'provider_unreachable', true);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new PaymentProviderError(
        'edfapay',
        `provider_http_${response.status}`,
        response.status >= 500 ||
          [408, 409, 425, 429].includes(response.status),
      );
    }
    try {
      return asEdfaPayRecord(await response.json());
    } catch {
      throw new PaymentProviderError(
        'edfapay',
        'provider_response_invalid',
        true,
      );
    }
  }

  async authorize(request: AuthorizeRequest): Promise<AuthorizeResult> {
    const amount = formatEdfaPayAmount(request.money.amount);
    const payload = await this.request('/api/v1/payment-gateway/initiate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        orderId: request.orderCode,
        currency: request.money.currency,
        amount: Number(amount),
        customerDetails: {
          name: `${request.payer.firstName} ${request.payer.lastName}`.trim(),
          email: request.payer.email,
          phone: request.payer.phone,
        },
        address: {
          country: request.payer.country,
          state: request.payer.city,
          city: request.payer.city,
          address: request.payer.address,
          zip: request.payer.zip,
        },
        recurringInit: 'N',
        auth: 'N',
        successUrl: request.returnUrl,
        failureUrl: request.returnUrl,
      }),
    });
    if (!edfaPayRootCodeSucceeded(payload)) {
      throw new PaymentProviderError('edfapay', 'provider_initiate_rejected');
    }
    const data = asEdfaPayRecord(payload.data);
    const redirectUrl =
      readEdfaPayText(data, 'redirectUrl') ??
      readEdfaPayText(data, 'redirect_url');
    if (!redirectUrl) {
      throw new PaymentProviderError(
        'edfapay',
        'provider_redirect_missing',
        true,
      );
    }
    return {
      redirectUrl,
      externalRef:
        readEdfaPayText(data, 'transactionId') ??
        readEdfaPayText(data, 'trans_id'),
    };
  }

  /** Hosted checkout captures in its purchase flow; this is a status probe. */
  async capture(request: CaptureRequest): Promise<PaymentOperationResult> {
    return this.status(
      request.orderCode,
      request.externalRef,
      request.money.amount,
      request.money.currency,
    );
  }

  async refund(request: RefundRequest): Promise<PaymentOperationResult> {
    if (!request.money) {
      throw new PaymentProviderError('edfapay', 'refund_amount_required');
    }
    const amount = formatEdfaPayAmount(request.money.amount);
    const payload = await this.request('/api/v1/payment-gateway/s2s/refund', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        transactionId: request.externalRef,
        amount: Number(amount),
      }),
    });
    const accepted = parseEdfaPayAcceptedRefund(payload, amount);
    if (!accepted) {
      throw new PaymentProviderError('edfapay', 'provider_refund_rejected');
    }
    if (!accepted.refundId) {
      throw new PaymentProviderError(
        'edfapay',
        'provider_refund_reference_missing',
        true,
      );
    }
    return {
      // Acceptance starts provider processing; authenticated status confirms it.
      outcome: 'PENDING',
      externalRef: accepted.refundId,
      declineReason: null,
    };
  }

  /** Authenticated source of truth for all webhook-triggered transitions. */
  async status(
    orderCode: string,
    externalRef: string,
    amount: string,
    currency: string,
  ): Promise<PaymentOperationResult> {
    const expectedAmount = formatEdfaPayAmount(amount);
    const query = new URLSearchParams({ id: externalRef });
    const payload = await this.request(
      `/api/v1/transactions/filterTransaction?${query.toString()}`,
      { method: 'GET' },
    );
    const result = parseEdfaPayTransactionStatus(payload, {
      transactionId: externalRef,
      orderId: orderCode,
      amount: expectedAmount,
      currency,
    });
    if (!result) {
      throw new PaymentProviderError(
        'edfapay',
        'provider_status_unusable',
        true,
      );
    }
    return result;
  }

  /** Extract identifiers only; the caller must confirm them through status(). */
  parseWebhook(payload: unknown): WebhookParseResult {
    const source = asEdfaPayRecord(payload);
    const details = asEdfaPayRecord(source.pgDetails);
    const operation = (
      readEdfaPayText(source, 'type') ??
      readEdfaPayText(source, 'transactionType')
    )?.toUpperCase();
    return {
      verified: false,
      orderCode:
        readEdfaPayText(source, 'orderId') ??
        readEdfaPayText(source, 'order_id'),
      externalRef:
        readEdfaPayText(source, 'transactionId') ??
        readEdfaPayText(source, 'trans_id'),
      outcome: outcomeFromEdfaPayStatus(
        readEdfaPayText(source, 'result'),
        readEdfaPayText(source, 'status'),
        readEdfaPayText(source, 'type'),
      ),
      operation: operation === 'REFUND' ? 'REFUND' : null,
      declineReason:
        readEdfaPayText(source, 'declineReason') ??
        readEdfaPayText(source, 'decline_reason') ??
        readEdfaPayText(details, 'reason'),
    };
  }
}

export function edfaPayProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): EdfaPayProvider | null {
  const config = edfaPayConfigFromEnv(env);
  return config ? new EdfaPayProvider(config) : null;
}
