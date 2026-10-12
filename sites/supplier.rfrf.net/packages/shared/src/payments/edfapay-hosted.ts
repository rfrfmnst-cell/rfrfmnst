import type { PaymentOperationResult } from './payment-provider';
import type { ProviderOutcome } from './payment-state';

export function asEdfaPayRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readEdfaPayText(
  source: Record<string, unknown>,
  key: string,
): string | null {
  const value = source[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : null;
}

/** HTTP 2xx is necessary but not sufficient; EdfaPay also reports root code. */
export function edfaPayRootCodeSucceeded(payload: unknown): boolean {
  return readEdfaPayText(asEdfaPayRecord(payload), 'code') === '200';
}

function upper(value: string | null): string {
  return value?.trim().toUpperCase() ?? '';
}

export const EDFAPAY_V1_CURRENCY = 'SAR';

const ISO_NUMERIC_CURRENCY: Readonly<Record<string, string>> = Object.freeze({
  [EDFAPAY_V1_CURRENCY]: '682',
});

function currencyMatches(reported: string | null, expected: string): boolean {
  const normalizedExpected = upper(expected);
  const normalizedReported = upper(reported);
  return (
    normalizedReported === normalizedExpected ||
    normalizedReported === ISO_NUMERIC_CURRENCY[normalizedExpected]
  );
}

function minorUnits(value: string | null): number | null {
  if (!value || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const units = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(units) ? units : null;
}

/** Validate the synchronous refund acknowledgement before storing its id. */
export function parseEdfaPayAcceptedRefund(
  payload: unknown,
  expectedAmount: string,
): { refundId: string | null } | null {
  const root = asEdfaPayRecord(payload);
  if (!edfaPayRootCodeSucceeded(root)) return null;
  const data = asEdfaPayRecord(root.data);
  const expectedUnits = minorUnits(expectedAmount);
  const reportedUnits = minorUnits(readEdfaPayText(data, 'amount'));
  if (
    readEdfaPayText(data, 'result')?.toUpperCase() !== 'ACCEPTED' ||
    expectedUnits === null ||
    reportedUnits !== expectedUnits
  ) {
    return null;
  }
  const refundId =
    readEdfaPayText(data, 'refundId') ?? readEdfaPayText(data, 'refund_id');
  return { refundId };
}

/** Translate both current Hosted v1 and legacy status spellings defensively. */
export function outcomeFromEdfaPayStatus(
  result: string | null,
  status: string | null,
  type: string | null = null,
): ProviderOutcome | null {
  const resultCode = upper(result);
  const statusCode = upper(status);
  const operation = upper(type);
  const codes = new Set([resultCode, statusCode]);

  if (codes.has('DECLINED') || codes.has('FAILED')) return 'DECLINED';
  if (
    codes.has('CANCELLED') ||
    codes.has('CANCELED') ||
    codes.has('REVERSAL') ||
    (operation === 'VOID' && codes.has('APPROVED'))
  ) {
    return 'CANCELLED';
  }
  if (
    codes.has('REFUND') ||
    codes.has('REFUNDED') ||
    (operation === 'REFUND' && (codes.has('APPROVED') || codes.has('SUCCESS')))
  ) {
    return 'REFUNDED';
  }
  if (
    operation === 'AUTHORIZATION' &&
    (codes.has('APPROVED') || codes.has('SUCCESS'))
  ) {
    return 'AUTHORIZED';
  }
  if (
    codes.has('SETTLED') ||
    ((operation === 'PURCHASE' || operation === 'CAPTURE') &&
      (codes.has('APPROVED') || codes.has('SUCCESS')))
  ) {
    return 'CAPTURED';
  }
  if (
    codes.has('PENDING') ||
    codes.has('PREPARE') ||
    codes.has('REDIRECT') ||
    codes.has('3DS')
  ) {
    return 'PENDING';
  }
  return null;
}

/**
 * Parse one authenticated transaction-query response and bind it to both the
 * expected provider reference and Rafraf order code before returning a state.
 */
export function parseEdfaPayTransactionStatus(
  payload: unknown,
  expected: {
    transactionId: string;
    orderId: string;
    amount: string;
    currency: string;
  },
): PaymentOperationResult | null {
  const root = asEdfaPayRecord(payload);
  if (!edfaPayRootCodeSucceeded(root)) return null;
  const data = asEdfaPayRecord(root.data);
  const content = Array.isArray(data.content) ? data.content : [];
  const transaction = content
    .map(asEdfaPayRecord)
    .find(
      (item) =>
        readEdfaPayText(item, 'transactionId') === expected.transactionId &&
        readEdfaPayText(item, 'orderId') === expected.orderId,
    );
  if (!transaction) return null;

  const expectedAmount = minorUnits(expected.amount);
  const reportedAmount = minorUnits(readEdfaPayText(transaction, 'amount'));
  if (
    expectedAmount === null ||
    reportedAmount !== expectedAmount ||
    !currencyMatches(
      readEdfaPayText(transaction, 'currencyCode') ??
        readEdfaPayText(transaction, 'currency'),
      expected.currency,
    )
  ) {
    return null;
  }
  const totalRefundAmount = minorUnits(
    readEdfaPayText(transaction, 'totalRefundAmount'),
  );
  const refundStatus = upper(readEdfaPayText(transaction, 'refundStatus'));
  const statusClaimsFull = ['FULL', 'FULLY_REFUNDED'].includes(refundStatus);
  const statusClaimsPartial = ['PARTIAL', 'PARTIALLY_REFUNDED'].includes(
    refundStatus,
  );
  const fullyRefunded = totalRefundAmount === expectedAmount;
  if (
    (statusClaimsFull && !fullyRefunded) ||
    (statusClaimsPartial && fullyRefunded) ||
    (totalRefundAmount !== null && totalRefundAmount > expectedAmount)
  ) {
    return null;
  }
  const reportedOutcome = outcomeFromEdfaPayStatus(
    readEdfaPayText(transaction, 'paymentStatus'),
    readEdfaPayText(transaction, 'transactionStatus'),
    readEdfaPayText(transaction, 'transactionType'),
  );
  const fullRefundHasTrustedBase =
    reportedOutcome === 'CAPTURED' || reportedOutcome === 'REFUNDED';
  if (fullyRefunded && !fullRefundHasTrustedBase) return null;
  // Rafraf supports one full refund only. A provider-approved partial refund
  // is not permission to reverse the entire local escrow ledger.
  const partialRefund =
    !fullyRefunded &&
    (statusClaimsPartial ||
      (totalRefundAmount !== null && totalRefundAmount > 0));
  if (reportedOutcome === 'REFUNDED' && !fullyRefunded && !partialRefund) {
    return null;
  }
  const outcome = fullyRefunded
    ? 'REFUNDED'
    : partialRefund
      ? 'PENDING'
      : reportedOutcome;
  if (!outcome) return null;
  const refundEligibility = fullyRefunded
    ? ('COMPLETED' as const)
    : partialRefund
      ? ('IN_PROGRESS' as const)
      : totalRefundAmount === 0 && refundStatus === 'NONE'
        ? ('NOT_STARTED' as const)
        : ('UNKNOWN' as const);

  const details = asEdfaPayRecord(transaction.pgDetails);
  return {
    outcome,
    externalRef: expected.transactionId,
    refundEligibility,
    declineReason:
      readEdfaPayText(transaction, 'declineReason') ??
      readEdfaPayText(details, 'reason') ??
      null,
    ...(partialRefund
      ? { reconciliationIssue: 'PROVIDER_PARTIAL_REFUND' as const }
      : {}),
  };
}
