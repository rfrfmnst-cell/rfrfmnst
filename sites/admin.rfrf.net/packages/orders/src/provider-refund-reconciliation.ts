import { PaymentRefundStatus, PaymentStatus, prisma } from '@rafraf/db';

export const FINANCIAL_RECONCILIATION_FAILURE = 'FINANCIAL_RESOLUTION_CONFLICT';
export const PARTIAL_REFUND_FAILURE = 'PROVIDER_PARTIAL_REFUND';
export const REFUND_SIGNAL_PENDING = 'PROVIDER_REFUND_SIGNAL_PENDING';
export const DUPLICATE_CAPTURE_FAILURE = 'DUPLICATE_PAYMENT_CAPTURE';
export const DUPLICATE_CAPTURE_RESOLVED = 'DUPLICATE_PAYMENT_CAPTURE_RESOLVED';
export const DUPLICATE_PARTIAL_REFUND_FAILURE =
  'DUPLICATE_CAPTURE_PARTIAL_REFUND';

export const REFUND_QUEUE_BLOCKING_STATUSES = [
  PaymentRefundStatus.REQUESTED,
  PaymentRefundStatus.PROCESSING,
  PaymentRefundStatus.PROVIDER_PENDING,
  PaymentRefundStatus.FAILED_RETRYABLE,
  PaymentRefundStatus.FAILED_FINAL,
] as const;

export const REFUND_QUEUE_BLOCKING_FAILURE_CODES = [
  FINANCIAL_RECONCILIATION_FAILURE,
  PARTIAL_REFUND_FAILURE,
  DUPLICATE_CAPTURE_FAILURE,
  DUPLICATE_PARTIAL_REFUND_FAILURE,
  REFUND_SIGNAL_PENDING,
] as const;

/** Global readiness tracks unresolved operations, not completed normal refunds. */
export function refundOperationBlocksReadiness(input: {
  status: PaymentRefundStatus;
  failureCode: string | null;
}): boolean {
  return (
    (REFUND_QUEUE_BLOCKING_STATUSES as readonly PaymentRefundStatus[]).includes(
      input.status,
    ) ||
    (input.failureCode !== null &&
      (REFUND_QUEUE_BLOCKING_FAILURE_CODES as readonly string[]).includes(
        input.failureCode,
      ))
  );
}

export function isDuplicateCaptureFailure(value: string | null): boolean {
  return (
    value === DUPLICATE_CAPTURE_FAILURE ||
    value === DUPLICATE_PARTIAL_REFUND_FAILURE
  );
}

/**
 * A completed duplicate-capture refund is remediation for the extra payment,
 * not a refund of the canonical order payment. It stops blocking payout only
 * when the operation and refunded payment agree exactly on amount/currency.
 */
export function refundOperationBlocksFinancialRelease(
  operation: {
    status: PaymentRefundStatus;
    failureCode: string | null;
    amount: unknown;
    currency: string;
    payment: {
      status: PaymentStatus;
      amount: unknown;
      currency: string;
    };
  },
  canonicalHold?: { amount: unknown; currency: string } | null,
): boolean {
  const resolvedDuplicate =
    Boolean(canonicalHold) &&
    operation.status === PaymentRefundStatus.COMPLETED &&
    operation.failureCode === DUPLICATE_CAPTURE_RESOLVED &&
    operation.payment.status === PaymentStatus.REFUNDED &&
    String(operation.amount) === String(operation.payment.amount) &&
    operation.currency === operation.payment.currency &&
    String(operation.amount) === String(canonicalHold?.amount) &&
    operation.currency === canonicalHold?.currency;
  // No generic FAILED_FINAL is proof that provider money did not move. Only
  // the fully reconciled extra-capture exception may stop blocking payout.
  return !resolvedDuplicate;
}

export type ProviderRefundReservation =
  | {
      outcome: 'RESERVED';
      orderCode: string;
      providerOrderCode: string;
      purchaseExternalRef: string | null;
      amount: string;
      currency: string;
      failureCode: string;
      duplicateCapture: boolean;
    }
  | { outcome: 'REPLAYED' | 'NOT_FOUND' };

export type RefundOperationUpdateOutcome =
  'REPLAYED' | 'PROVIDER_PENDING' | 'FAILED_FINAL' | 'NOT_FOUND';

export async function updateOpenRefundOperation(
  input: {
    operationId: string;
    status: PaymentRefundStatus;
    externalRef?: string | null;
    failureCode: string | null;
  },
  client: typeof prisma,
): Promise<RefundOperationUpdateOutcome | null> {
  const promotedFailureCodes =
    input.failureCode === PARTIAL_REFUND_FAILURE
      ? [REFUND_SIGNAL_PENDING]
      : input.failureCode === DUPLICATE_PARTIAL_REFUND_FAILURE
        ? [
            REFUND_SIGNAL_PENDING,
            PARTIAL_REFUND_FAILURE,
            DUPLICATE_CAPTURE_FAILURE,
          ]
        : [];
  const acceptedFailureCodes = input.failureCode
    ? [input.failureCode, ...promotedFailureCodes]
    : [];
  const changed = await client.paymentRefund.updateMany({
    where: {
      id: input.operationId,
      status: {
        in: [
          PaymentRefundStatus.PROCESSING,
          PaymentRefundStatus.PROVIDER_PENDING,
        ],
      },
      AND: [
        {
          OR: [
            { failureCode: null },
            ...(acceptedFailureCodes.length > 0
              ? [{ failureCode: { in: acceptedFailureCodes } }]
              : []),
            {
              failureCode: {
                notIn: [
                  FINANCIAL_RECONCILIATION_FAILURE,
                  PARTIAL_REFUND_FAILURE,
                  REFUND_SIGNAL_PENDING,
                  DUPLICATE_CAPTURE_FAILURE,
                  DUPLICATE_PARTIAL_REFUND_FAILURE,
                ],
              },
            },
          ],
        },
        ...(input.externalRef
          ? [
              {
                OR: [{ externalRef: null }, { externalRef: input.externalRef }],
              },
            ]
          : []),
      ],
    },
    data: {
      status: input.status,
      externalRef: input.externalRef,
      failureCode: input.failureCode,
    },
  });
  if (changed.count === 1) return null;

  const current = await client.paymentRefund.findUnique({
    where: { id: input.operationId },
    select: { status: true, failureCode: true, externalRef: true },
  });
  if (!current) return 'NOT_FOUND';
  if (
    input.externalRef &&
    current.externalRef &&
    current.externalRef !== input.externalRef
  ) {
    await client.paymentRefund.updateMany({
      where: {
        id: input.operationId,
        status: {
          in: [
            PaymentRefundStatus.PROCESSING,
            PaymentRefundStatus.PROVIDER_PENDING,
          ],
        },
        externalRef: current.externalRef,
      },
      data: {
        status: PaymentRefundStatus.PROVIDER_PENDING,
        failureCode: FINANCIAL_RECONCILIATION_FAILURE,
      },
    });
    return 'PROVIDER_PENDING';
  }
  if (current.status === PaymentRefundStatus.COMPLETED) return 'REPLAYED';
  if (current.status === PaymentRefundStatus.FAILED_FINAL) {
    return 'FAILED_FINAL';
  }
  return 'PROVIDER_PENDING';
}

/**
 * Persist a signed provider refund wake-up before any network confirmation.
 * Settlement takes the same order lock and refuses every non-final refund
 * operation, so money cannot be released while provider state is in flight.
 */
export async function reserveProviderRefundReconciliation(
  input: {
    paymentId: string;
    actorId: string;
    provider: string;
    refundExternalRef?: string | null;
    failureCode?: string | null;
  },
  client: typeof prisma = prisma,
): Promise<ProviderRefundReservation> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment-refund:${input.paymentId}`}))`;
    const paymentScope = await tx.payment.findUnique({
      where: { id: input.paymentId },
      select: { orderId: true },
    });
    if (!paymentScope) return { outcome: 'NOT_FOUND' as const };

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order-financial-resolution:${paymentScope.orderId}`}))`;
    const payment = await tx.payment.findUnique({
      where: { id: input.paymentId },
      select: {
        id: true,
        orderId: true,
        provider: true,
        amount: true,
        currency: true,
        externalRef: true,
        providerOrderCode: true,
        order: { select: { code: true } },
        refunds: {
          take: 1,
          select: {
            id: true,
            status: true,
            externalRef: true,
            failureCode: true,
          },
        },
      },
    });
    if (!payment || payment.provider !== input.provider) {
      return { outcome: 'NOT_FOUND' as const };
    }

    const existing = payment.refunds[0];
    const existingFailure = existing?.failureCode ?? null;
    const duplicateCapture =
      isDuplicateCaptureFailure(existingFailure) ||
      existingFailure === DUPLICATE_CAPTURE_RESOLVED;
    const refundReferenceConflict = Boolean(
      existing?.externalRef &&
      input.refundExternalRef &&
      existing.externalRef !== input.refundExternalRef,
    );
    const completedReferenceRecovery = Boolean(
      existing?.status === PaymentRefundStatus.COMPLETED &&
      !existing.externalRef &&
      input.refundExternalRef,
    );
    if (
      existing?.status === PaymentRefundStatus.COMPLETED &&
      !refundReferenceConflict &&
      !completedReferenceRecovery
    ) {
      return { outcome: 'REPLAYED' as const };
    }
    let failureCode = input.failureCode ?? REFUND_SIGNAL_PENDING;
    if (refundReferenceConflict) {
      failureCode = FINANCIAL_RECONCILIATION_FAILURE;
    } else if (
      isDuplicateCaptureFailure(existingFailure) &&
      input.failureCode === PARTIAL_REFUND_FAILURE
    ) {
      failureCode = DUPLICATE_PARTIAL_REFUND_FAILURE;
    } else if (
      existingFailure === FINANCIAL_RECONCILIATION_FAILURE ||
      existingFailure === PARTIAL_REFUND_FAILURE ||
      isDuplicateCaptureFailure(existingFailure)
    ) {
      failureCode = existingFailure ?? failureCode;
    }
    if (completedReferenceRecovery) {
      return {
        outcome: 'RESERVED' as const,
        orderCode: payment.order.code,
        providerOrderCode: payment.providerOrderCode ?? payment.order.code,
        purchaseExternalRef: payment.externalRef,
        amount: payment.amount.toFixed(2),
        currency: payment.currency,
        failureCode,
        duplicateCapture,
      };
    }
    if (existing) {
      await tx.paymentRefund.update({
        where: { id: existing.id },
        data: {
          status: PaymentRefundStatus.PROVIDER_PENDING,
          externalRef: existing.externalRef ?? input.refundExternalRef,
          failureCode,
        },
      });
    } else {
      await tx.paymentRefund.create({
        data: {
          paymentId: payment.id,
          orderId: payment.orderId,
          amount: payment.amount,
          currency: payment.currency,
          requestedBy: input.actorId,
          status: PaymentRefundStatus.PROVIDER_PENDING,
          externalRef: input.refundExternalRef,
          failureCode,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorType: 'SYSTEM',
        action: refundReferenceConflict
          ? 'payment.refund.reference_conflict'
          : input.failureCode
            ? 'payment.refund.reconciliation_required'
            : 'payment.refund.provider_wakeup_reserved',
        entityType: 'payment',
        entityId: payment.id,
        after: {
          provider: input.provider,
          failureCode,
        },
      },
    });
    return {
      outcome: 'RESERVED' as const,
      orderCode: payment.order.code,
      providerOrderCode: payment.providerOrderCode ?? payment.order.code,
      purchaseExternalRef: payment.externalRef,
      amount: payment.amount.toFixed(2),
      currency: payment.currency,
      failureCode,
      duplicateCapture,
    };
  });
}
