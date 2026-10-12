import { normalizeEdfaPayApiBaseUrl } from './edfapay-endpoint';
import {
  asEdfaPayRecord,
  parseEdfaPayAcceptedRefund,
  parseEdfaPayTransactionStatus,
} from './edfapay-hosted';
import {
  PaymentProviderError,
  type PaymentOperationResult,
  type RefundRequest,
} from './payment-provider';

const REQUEST_TIMEOUT_MS = 20_000;

export interface RefundPaymentProvider {
  readonly name: string;
  refund(request: RefundRequest): Promise<PaymentOperationResult>;
  status(
    orderCode: string,
    externalRef: string,
    amount: string,
    currency: string,
  ): Promise<PaymentOperationResult>;
}

function money(value: string): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new PaymentProviderError('edfapay', 'amount_invalid');
  }
  return numeric.toFixed(2);
}

async function providerRequest(
  baseUrl: string,
  apiKey: string,
  path: string,
  init: Omit<RequestInit, 'signal' | 'cache'>,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        'X-API-KEY': apiKey,
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
      response.status >= 500 || [408, 409, 425, 429].includes(response.status),
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

export function edfaPayRefundProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
): RefundPaymentProvider | null {
  const apiKey = env.EDFAPAY_API_KEY?.trim();
  const baseUrl = normalizeEdfaPayApiBaseUrl(env.EDFAPAY_BASE_URL);
  if (!apiKey || !baseUrl) return null;

  return {
    name: 'EDFAPAY',
    async refund(request): Promise<PaymentOperationResult> {
      if (!request.money) {
        throw new PaymentProviderError('edfapay', 'refund_amount_required');
      }
      const amount = money(request.money.amount);
      const payload = await providerRequest(
        baseUrl,
        apiKey,
        '/api/v1/payment-gateway/s2s/refund',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            transactionId: request.externalRef,
            amount: Number(amount),
          }),
        },
        requestTimeoutMs,
      );
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
        outcome: 'PENDING',
        externalRef: accepted.refundId,
        declineReason: null,
      };
    },
    async status(
      orderCode,
      externalRef,
      amount,
      currency,
    ): Promise<PaymentOperationResult> {
      const expectedAmount = money(amount);
      const query = new URLSearchParams({ id: externalRef });
      const payload = await providerRequest(
        baseUrl,
        apiKey,
        `/api/v1/transactions/filterTransaction?${query.toString()}`,
        { method: 'GET' },
        requestTimeoutMs,
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
    },
  };
}
