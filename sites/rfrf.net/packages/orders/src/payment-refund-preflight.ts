import { PaymentRefundStatus, prisma } from '@rafraf/db';
import type { RefundPaymentProvider } from '@rafraf/shared/payments/edfapay-refund-provider';
import { PARTIAL_REFUND_FAILURE } from './provider-refund-reconciliation.ts';

export type RefundPreflightOutcome =
  | 'ALREADY_REFUNDED'
  | 'REFUNDABLE'
  | 'PARTIAL_REFUND'
  | 'PROVIDER_CONFLICT'
  | 'RETRY';

export type RefundReservationOutcome =
  'REPLAYED' | 'PROVIDER_PENDING' | 'FAILED_FINAL' | 'NOT_FOUND';

/** Authenticated read-before-write gate for the purchase transaction. */
export async function preflightPurchaseRefund(input: {
  orderCode: string;
  purchaseExternalRef: string;
  amount: string;
  currency: string;
  provider: RefundPaymentProvider;
}): Promise<RefundPreflightOutcome> {
  try {
    const result = await input.provider.status(
      input.orderCode,
      input.purchaseExternalRef,
      input.amount,
      input.currency,
    );
    if (result.reconciliationIssue === PARTIAL_REFUND_FAILURE) {
      return 'PARTIAL_REFUND';
    }
    if (
      result.outcome === 'REFUNDED' &&
      result.refundEligibility === 'COMPLETED'
    ) {
      return 'ALREADY_REFUNDED';
    }
    if (
      result.outcome === 'CAPTURED' &&
      result.refundEligibility === 'NOT_STARTED'
    ) {
      return 'REFUNDABLE';
    }
    if (
      result.outcome === 'CAPTURED' ||
      result.outcome === 'REFUNDED' ||
      result.refundEligibility === 'IN_PROGRESS' ||
      result.refundEligibility === 'UNKNOWN'
    ) {
      return 'PROVIDER_CONFLICT';
    }
    if (result.outcome === 'DECLINED' || result.outcome === 'CANCELLED') {
      return 'PROVIDER_CONFLICT';
    }
    return 'RETRY';
  } catch {
    // A timeout or unusable status may follow a successful provider read. Do
    // not reserve a POST; leave REQUESTED durable for a safe status retry.
    return 'RETRY';
  }
}

async function currentRefundOperationOutcome(
  operationId: string,
  client: typeof prisma,
): Promise<RefundReservationOutcome> {
  const current = await client.paymentRefund.findUnique({
    where: { id: operationId },
    select: { status: true },
  });
  if (!current) return 'NOT_FOUND';
  if (current.status === PaymentRefundStatus.COMPLETED) return 'REPLAYED';
  if (current.status === PaymentRefundStatus.FAILED_FINAL) {
    return 'FAILED_FINAL';
  }
  return 'PROVIDER_PENDING';
}

/** Exactly one caller may promote REQUESTED and send the external POST. */
export async function reserveRefundPost(
  operationId: string,
  client: typeof prisma,
): Promise<'RESERVED' | RefundReservationOutcome> {
  const changed = await client.paymentRefund.updateMany({
    where: { id: operationId, status: PaymentRefundStatus.REQUESTED },
    data: { status: PaymentRefundStatus.PROCESSING },
  });
  return changed.count === 1
    ? 'RESERVED'
    : currentRefundOperationOutcome(operationId, client);
}

/** Move an authoritative conflict to the payout-blocking manual queue. */
export async function protectRequestedRefund(
  operationId: string,
  failureCode: string,
  client: typeof prisma,
): Promise<RefundReservationOutcome> {
  const changed = await client.paymentRefund.updateMany({
    where: { id: operationId, status: PaymentRefundStatus.REQUESTED },
    data: {
      status: PaymentRefundStatus.PROVIDER_PENDING,
      failureCode,
    },
  });
  return changed.count === 1
    ? 'PROVIDER_PENDING'
    : currentRefundOperationOutcome(operationId, client);
}
