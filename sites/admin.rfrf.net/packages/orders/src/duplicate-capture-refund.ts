import {
  ActorType,
  EscrowEntryType,
  PaymentRefundStatus,
  PaymentStatus,
  prisma,
} from '@rafraf/db';
import type { RefundPaymentProvider } from '@rafraf/shared/payments/edfapay-refund-provider';
import { ACTIVE_PAYMENT_INTAKE_STATUSES } from '@rafraf/shared/payments/payment-intake';
import {
  DUPLICATE_CAPTURE_RESOLVED,
  DUPLICATE_PARTIAL_REFUND_FAILURE,
  DUPLICATE_CAPTURE_FAILURE,
  FINANCIAL_RECONCILIATION_FAILURE,
  isDuplicateCaptureFailure,
  updateOpenRefundOperation,
} from './provider-refund-reconciliation.ts';

export type DuplicateCaptureRefundOutcome =
  | 'COMPLETED'
  | 'REPLAYED'
  | 'PROVIDER_PENDING'
  | 'FAILED_FINAL'
  | 'NOT_FOUND'
  | 'NOT_ACTIONABLE';

export async function reconcileDuplicateCaptureRefund(
  input: {
    paymentId: string;
    actorId: string;
    actorType: ActorType;
    provider: string;
    externalRef?: string | null;
  },
  client: typeof prisma = prisma,
): Promise<DuplicateCaptureRefundOutcome> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment-refund:${input.paymentId}`}))`;
    const scope = await tx.payment.findUnique({
      where: { id: input.paymentId },
      select: { orderId: true },
    });
    if (!scope) return 'NOT_FOUND';
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order-financial-resolution:${scope.orderId}`}))`;

    const payment = await tx.payment.findUnique({
      where: { id: input.paymentId },
      select: {
        id: true,
        orderId: true,
        provider: true,
        status: true,
        amount: true,
        currency: true,
        refunds: { take: 1 },
      },
    });
    if (!payment || payment.provider !== input.provider) return 'NOT_FOUND';
    const operation = payment.refunds[0];
    if (
      payment.status === PaymentStatus.REFUNDED &&
      operation?.status === PaymentRefundStatus.COMPLETED
    ) {
      if (
        operation.externalRef &&
        input.externalRef &&
        operation.externalRef !== input.externalRef
      ) {
        await tx.paymentRefund.update({
          where: { id: operation.id },
          data: {
            status: PaymentRefundStatus.PROVIDER_PENDING,
            failureCode: FINANCIAL_RECONCILIATION_FAILURE,
          },
        });
        return 'NOT_ACTIONABLE';
      }
      if (!operation.externalRef && input.externalRef) {
        await tx.paymentRefund.update({
          where: { id: operation.id },
          data: { externalRef: input.externalRef },
        });
        await tx.auditLog.create({
          data: {
            actorId: input.actorId,
            actorType: input.actorType,
            action: 'payment.refund.reference_recovered',
            entityType: 'payment_refund',
            entityId: operation.id,
            after: { provider: input.provider },
          },
        });
      }
      return 'REPLAYED';
    }
    if (
      !operation ||
      !isDuplicateCaptureFailure(operation.failureCode) ||
      !operation.amount.equals(payment.amount) ||
      operation.currency !== payment.currency ||
      (payment.status !== PaymentStatus.CAPTURED &&
        payment.status !== PaymentStatus.HELD)
    ) {
      return 'NOT_ACTIONABLE';
    }

    const [otherPayment, hold] = await Promise.all([
      tx.payment.findFirst({
        where: {
          orderId: payment.orderId,
          id: { not: payment.id },
          status: { in: [...ACTIVE_PAYMENT_INTAKE_STATUSES] },
        },
        select: { id: true },
      }),
      tx.escrowLedgerEntry.findFirst({
        where: {
          orderId: payment.orderId,
          entryType: EscrowEntryType.HOLD,
        },
        select: { paymentId: true },
      }),
    ]);
    if (!otherPayment && (!hold || hold.paymentId === payment.id)) {
      return 'NOT_ACTIONABLE';
    }

    const changed = await tx.payment.updateMany({
      where: { id: payment.id, status: payment.status },
      data: { status: PaymentStatus.REFUNDED },
    });
    if (changed.count !== 1) return 'NOT_ACTIONABLE';
    await tx.paymentRefund.update({
      where: { id: operation.id },
      data: {
        status: PaymentRefundStatus.COMPLETED,
        externalRef: operation.externalRef ?? input.externalRef,
        failureCode: DUPLICATE_CAPTURE_RESOLVED,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorType: input.actorType,
        action: 'payment.duplicate_capture.refunded',
        entityType: 'payment',
        entityId: payment.id,
        after: { provider: input.provider },
      },
    });
    return 'COMPLETED';
  });
}

export async function resolveDuplicateCaptureRefund(
  input: {
    action: 'CALL_PROVIDER' | 'CHECK_PROVIDER';
    paymentId: string;
    operationId: string;
    actorId: string;
    orderCode: string;
    purchaseExternalRef: string;
    amount: string;
    currency: string;
    provider: RefundPaymentProvider;
  },
  client: typeof prisma = prisma,
): Promise<DuplicateCaptureRefundOutcome> {
  let result;
  try {
    result =
      input.action === 'CALL_PROVIDER'
        ? await input.provider.refund({
            orderCode: input.orderCode,
            externalRef: input.purchaseExternalRef,
            money: { amount: input.amount, currency: input.currency },
          })
        : await input.provider.status(
            input.orderCode,
            input.purchaseExternalRef,
            input.amount,
            input.currency,
          );
  } catch {
    // Even a typed 4xx can race a provider-side refund. Allow neither another
    // POST nor settlement until authenticated status is conclusive.
    result = null;
  }
  if (!result || result.outcome !== 'REFUNDED') {
    const concurrentOutcome = await updateOpenRefundOperation(
      {
        operationId: input.operationId,
        status: PaymentRefundStatus.PROVIDER_PENDING,
        externalRef:
          input.action === 'CALL_PROVIDER' ? result?.externalRef : null,
        failureCode:
          result?.reconciliationIssue === 'PROVIDER_PARTIAL_REFUND'
            ? DUPLICATE_PARTIAL_REFUND_FAILURE
            : DUPLICATE_CAPTURE_FAILURE,
      },
      client,
    );
    return concurrentOutcome ?? 'PROVIDER_PENDING';
  }
  return reconcileDuplicateCaptureRefund(
    {
      paymentId: input.paymentId,
      actorId: input.actorId,
      actorType: ActorType.ADMIN,
      provider: input.provider.name,
      externalRef: input.action === 'CALL_PROVIDER' ? result.externalRef : null,
    },
    client,
  );
}
