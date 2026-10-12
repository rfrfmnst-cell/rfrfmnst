import {
  ActorType,
  EscrowEntryType,
  OrderStatus,
  PayoutStatus,
  PaymentRefundStatus,
  PaymentStatus,
  prisma,
} from '@rafraf/db';
import { canTransitionOrder } from '@rafraf/shared/workflow/order-state';
import { FINANCIAL_RECONCILIATION_FAILURE } from './provider-refund-reconciliation.ts';

export type ReconcileConfirmedRefundOutcome =
  'COMPLETED' | 'REPLAYED' | 'RECONCILIATION_REQUIRED' | 'NOT_FOUND';

/**
 * Reconcile a refund that the provider has already confirmed.
 *
 * This is the only writer allowed to move a captured/held payment, its escrow
 * ledger, and its order to REFUNDED. Both an operator-initiated refund and an
 * unsolicited provider webhook use this boundary, so a late callback cannot
 * refund the customer after the supplier payout has been released.
 */
export async function reconcileConfirmedRefund(
  input: {
    paymentId: string;
    actorId: string;
    actorType: ActorType;
    provider: string;
    externalRef?: string | null;
  },
  client: typeof prisma = prisma,
): Promise<ReconcileConfirmedRefundOutcome> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment-refund:${input.paymentId}`}))`;
    const paymentScope = await tx.payment.findUnique({
      where: { id: input.paymentId },
      select: { orderId: true },
    });
    if (!paymentScope) return 'NOT_FOUND';

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order-financial-resolution:${paymentScope.orderId}`}))`;
    const payment = await tx.payment.findUnique({
      where: { id: input.paymentId },
      include: {
        order: { select: { status: true, supplierId: true } },
        refunds: { take: 1 },
        escrowEntries: {
          select: { entryType: true, amount: true, currency: true },
        },
      },
    });
    if (!payment) return 'NOT_FOUND';

    const operation = payment.refunds[0];
    const holds = payment.escrowEntries.filter(
      (entry) => entry.entryType === EscrowEntryType.HOLD,
    );
    const hold = holds[0];
    const refundEntry = payment.escrowEntries.find(
      (entry) => entry.entryType === EscrowEntryType.REFUND,
    );
    const releaseOrPayout = payment.escrowEntries.some(
      (entry) =>
        entry.entryType === EscrowEntryType.RELEASE ||
        entry.entryType === EscrowEntryType.PAYOUT,
    );
    const supplierPayout = await tx.supplierPayout.findFirst({
      where: {
        orderId: payment.orderId,
        status: { not: PayoutStatus.CANCELLED },
      },
      select: { id: true, status: true },
    });
    const refundEntryMatches = Boolean(
      refundEntry &&
      refundEntry.amount.equals(payment.amount.negated()) &&
      refundEntry.currency === payment.currency,
    );
    const holdMatches = Boolean(
      holds.length === 1 &&
      hold?.amount.equals(payment.amount) &&
      hold.currency === payment.currency,
    );
    const alreadyReconciled =
      payment.status === PaymentStatus.REFUNDED &&
      payment.order.status === OrderStatus.REFUNDED &&
      holdMatches &&
      refundEntryMatches &&
      !releaseOrPayout &&
      !supplierPayout;

    const referenceConflict = Boolean(
      operation?.externalRef &&
      input.externalRef &&
      operation.externalRef !== input.externalRef,
    );
    if (referenceConflict && operation) {
      await tx.paymentRefund.update({
        where: { id: operation.id },
        data: {
          status: PaymentRefundStatus.PROVIDER_PENDING,
          failureCode: FINANCIAL_RECONCILIATION_FAILURE,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          actorType: input.actorType,
          action: 'payment.refund.reference_conflict',
          entityType: 'payment',
          entityId: payment.id,
          after: {
            provider: input.provider,
            failureCode: FINANCIAL_RECONCILIATION_FAILURE,
          },
        },
      });
      return 'RECONCILIATION_REQUIRED';
    }

    if (alreadyReconciled) {
      if (operation) {
        if (
          operation.status !== PaymentRefundStatus.COMPLETED ||
          (!operation.externalRef && input.externalRef)
        ) {
          await tx.paymentRefund.update({
            where: { id: operation.id },
            data: {
              status: PaymentRefundStatus.COMPLETED,
              externalRef: operation.externalRef ?? input.externalRef,
              failureCode: null,
            },
          });
          if (!operation.externalRef && input.externalRef) {
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
        }
      } else {
        await tx.paymentRefund.create({
          data: {
            paymentId: payment.id,
            orderId: payment.orderId,
            amount: payment.amount,
            currency: payment.currency,
            requestedBy: input.actorId,
            status: PaymentRefundStatus.COMPLETED,
            externalRef: input.externalRef,
          },
        });
      }
      return 'REPLAYED';
    }

    const conflict =
      (payment.status !== PaymentStatus.CAPTURED &&
        payment.status !== PaymentStatus.HELD) ||
      !canTransitionOrder(payment.order.status, OrderStatus.REFUNDED) ||
      !holdMatches ||
      Boolean(refundEntry) ||
      releaseOrPayout ||
      Boolean(supplierPayout);

    if (conflict) {
      if (operation && operation.status !== PaymentRefundStatus.COMPLETED) {
        await tx.paymentRefund.update({
          where: { id: operation.id },
          data: {
            status: PaymentRefundStatus.PROVIDER_PENDING,
            externalRef: operation.externalRef ?? input.externalRef,
            failureCode: FINANCIAL_RECONCILIATION_FAILURE,
          },
        });
      } else if (!operation) {
        await tx.paymentRefund.create({
          data: {
            paymentId: payment.id,
            orderId: payment.orderId,
            amount: payment.amount,
            currency: payment.currency,
            requestedBy: input.actorId,
            status: PaymentRefundStatus.PROVIDER_PENDING,
            externalRef: input.externalRef,
            failureCode: FINANCIAL_RECONCILIATION_FAILURE,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          actorType: input.actorType,
          action: 'payment.refund.reconciliation_blocked',
          entityType: 'payment',
          entityId: payment.id,
          after: {
            paymentStatus: payment.status,
            orderStatus: payment.order.status,
            hasRefundEntry: Boolean(refundEntry),
            hasReleaseOrPayout: releaseOrPayout,
            hasSupplierPayout: Boolean(supplierPayout),
            provider: input.provider,
          },
        },
      });
      return 'RECONCILIATION_REQUIRED';
    }

    const changedPayment = await tx.payment.updateMany({
      where: { id: payment.id, status: payment.status },
      // Keep the original purchase transaction reference on Payment. A refund
      // webhook may carry its own transaction id; that belongs to the refund
      // operation and must not replace the identifier used for reconciliation.
      data: { status: PaymentStatus.REFUNDED },
    });
    if (changedPayment.count !== 1) {
      throw new Error('Payment changed during refund reconciliation');
    }
    await tx.escrowLedgerEntry.create({
      data: {
        orderId: payment.orderId,
        supplierId: payment.order.supplierId,
        paymentId: payment.id,
        entryType: EscrowEntryType.REFUND,
        amount: payment.amount.negated(),
        currency: payment.currency,
        note: `استرداد كامل عبر ${input.provider}`,
        createdBy: input.actorId,
      },
    });
    const changedOrder = await tx.order.updateMany({
      where: { id: payment.orderId, status: payment.order.status },
      data: { status: OrderStatus.REFUNDED },
    });
    if (changedOrder.count !== 1) {
      throw new Error('Order changed during refund reconciliation');
    }
    await tx.orderEvent.create({
      data: {
        orderId: payment.orderId,
        fromStatus: payment.order.status,
        toStatus: OrderStatus.REFUNDED,
        actorType: input.actorType,
        actorId: input.actorId,
        note: `تم رد الدفع عبر ${input.provider}`,
      },
    });
    if (operation) {
      await tx.paymentRefund.update({
        where: { id: operation.id },
        data: {
          status: PaymentRefundStatus.COMPLETED,
          externalRef: operation.externalRef ?? input.externalRef,
          failureCode: null,
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
          status: PaymentRefundStatus.COMPLETED,
          externalRef: input.externalRef,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorType: input.actorType,
        action: 'payment.refund.reconciled',
        entityType: 'payment',
        entityId: payment.id,
        before: {
          paymentStatus: payment.status,
          orderStatus: payment.order.status,
        },
        after: {
          paymentStatus: PaymentStatus.REFUNDED,
          orderStatus: OrderStatus.REFUNDED,
          provider: input.provider,
        },
      },
    });
    return 'COMPLETED';
  });
}
