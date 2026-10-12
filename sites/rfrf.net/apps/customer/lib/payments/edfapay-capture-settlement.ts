import {
  ActorType,
  EscrowEntryType,
  OrderStatus,
  PaymentRefundStatus,
  PaymentStatus,
  prisma,
} from '@rafraf/db';
import {
  DUPLICATE_CAPTURE_FAILURE,
  DUPLICATE_PARTIAL_REFUND_FAILURE,
  PARTIAL_REFUND_FAILURE,
} from '@rafraf/orders';
import type { RefundPaymentProvider } from '@rafraf/shared/payments/edfapay-refund-provider';
import {
  ACTIVE_PAYMENT_INTAKE_STATUSES,
  hasPaymentCaptureConflict,
  orderPaymentIntakeLockKey,
} from '@rafraf/shared/payments/payment-intake';
import { isOrderPayable } from '@rafraf/shared/payments/payment-state';
import { assertOrderTransition } from '@rafraf/shared/workflow/order-state';
import { loadPaymentIntakeEligibilityBlockReason } from './payment-intake-eligibility';
import {
  POST_CHECKOUT_POLICY_REFUND_PREFIX,
  POST_CHECKOUT_POLICY_REFUND_REASON,
} from './edfapay-policy-refund';
import type { EdfaPayWebhookPayment } from './edfapay-webhook-payment';

/** Another signed callback won the compare-and-swap. */
class CaptureAlreadyApplied extends Error {}

export type EdfaPayCaptureSettlementOutcome =
  'APPLIED' | 'ALREADY_APPLIED' | 'POLICY_REFUND_REQUESTED';

/**
 * Atomically binds a confirmed provider result to Payment, escrow, and Order.
 * A mutable-policy drift is quarantined in escrow and never reaches supplier
 * confirmation; the caller then resumes the durable refund outside this DB
 * transaction.
 */
export async function settleConfirmedEdfaPayOutcome(input: {
  payment: EdfaPayWebhookPayment;
  provider: RefundPaymentProvider;
  nextStatus: PaymentStatus;
  confirmedExternalRef: string | null;
  fallbackExternalRef: string;
  holdsEscrow: boolean;
}): Promise<EdfaPayCaptureSettlementOutcome> {
  try {
    const settlement = await prisma.$transaction(async (tx) => {
      const financialLock = `order-financial-resolution:${input.payment.orderId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${financialLock}))`;
      const intakeLock = orderPaymentIntakeLockKey(input.payment.orderId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${intakeLock}))`;

      let currentOrder = input.payment.order;
      let existingHold: { paymentId: string | null } | null = null;
      let policyBlock: string | null = null;
      if (input.holdsEscrow) {
        const [orderSnapshot, holdSnapshot, activeOtherPayment] =
          await Promise.all([
            tx.order.findUnique({
              where: { id: input.payment.orderId },
              select: { code: true, status: true, supplierId: true },
            }),
            tx.escrowLedgerEntry.findFirst({
              where: {
                orderId: input.payment.orderId,
                entryType: EscrowEntryType.HOLD,
              },
              select: { paymentId: true },
            }),
            tx.payment.findFirst({
              where: {
                orderId: input.payment.orderId,
                id: { not: input.payment.id },
                status: { in: [...ACTIVE_PAYMENT_INTAKE_STATUSES] },
              },
              select: { id: true },
            }),
          ]);
        if (!orderSnapshot) throw new Error('Paid order no longer exists');
        currentOrder = orderSnapshot;
        existingHold = holdSnapshot;

        if (
          hasPaymentCaptureConflict({
            orderStatus: currentOrder.status,
            currentPaymentId: input.payment.id,
            activeOtherPaymentId: activeOtherPayment?.id ?? null,
            existingHold,
          })
        ) {
          const captured = await tx.payment.updateMany({
            where: {
              id: input.payment.id,
              status: input.payment.status,
            },
            data: {
              status: PaymentStatus.CAPTURED,
              externalRef:
                input.confirmedExternalRef ?? input.fallbackExternalRef,
              failureCode: null,
            },
          });
          if (captured.count !== 1) throw new CaptureAlreadyApplied();

          const refund = await tx.paymentRefund.findUnique({
            where: { paymentId: input.payment.id },
            select: { id: true, status: true, failureCode: true },
          });
          if (refund && refund.status !== PaymentRefundStatus.COMPLETED) {
            const failureCode =
              refund.failureCode === PARTIAL_REFUND_FAILURE ||
              refund.failureCode === DUPLICATE_PARTIAL_REFUND_FAILURE
                ? DUPLICATE_PARTIAL_REFUND_FAILURE
                : DUPLICATE_CAPTURE_FAILURE;
            await tx.paymentRefund.update({
              where: { id: refund.id },
              data: { failureCode },
            });
          } else if (!refund) {
            await tx.paymentRefund.create({
              data: {
                paymentId: input.payment.id,
                orderId: input.payment.orderId,
                amount: input.payment.amount,
                currency: input.payment.currency,
                requestedBy: 'edfapay-webhook',
                status: PaymentRefundStatus.REQUESTED,
                failureCode: DUPLICATE_CAPTURE_FAILURE,
              },
            });
          }
          await tx.auditLog.create({
            data: {
              actorType: ActorType.SYSTEM,
              action: 'payment.capture.reconciliation_required',
              entityType: 'payment',
              entityId: input.payment.id,
              after: {
                provider: input.provider.name,
                failureCode: DUPLICATE_CAPTURE_FAILURE,
              },
            },
          });
          return 'APPLIED' as const;
        }

        policyBlock = await loadPaymentIntakeEligibilityBlockReason(
          tx,
          input.payment.orderId,
        );
      }

      const updated = await tx.payment.updateMany({
        where: { id: input.payment.id, status: input.payment.status },
        data: {
          status: input.nextStatus,
          externalRef: input.confirmedExternalRef ?? input.fallbackExternalRef,
          failureCode: null,
        },
      });
      if (updated.count !== 1) throw new CaptureAlreadyApplied();

      await tx.auditLog.create({
        data: {
          actorType: ActorType.SYSTEM,
          action: 'payment.status.confirmed',
          entityType: 'payment',
          entityId: input.payment.id,
          after: {
            from: input.payment.status,
            to: input.nextStatus,
            provider: input.provider.name,
          },
        },
      });
      if (!input.holdsEscrow || existingHold) return 'APPLIED' as const;

      if (!isOrderPayable(currentOrder.status)) {
        throw new Error('Captured order is no longer payable');
      }
      if (!currentOrder.supplierId && !policyBlock) {
        throw new Error('Paid order has no assigned supplier');
      }

      await tx.escrowLedgerEntry.create({
        data: {
          orderId: input.payment.orderId,
          supplierId: currentOrder.supplierId,
          paymentId: input.payment.id,
          entryType: EscrowEntryType.HOLD,
          amount: input.payment.amount,
          currency: input.payment.currency,
          note: policyBlock
            ? `دفع إلكتروني (${input.provider.name}) — محتجز بانتظار الاسترداد الآلي`
            : `دفع إلكتروني (${input.provider.name}) — محتجز حتى التسليم`,
          createdBy: 'edfapay-webhook',
        },
      });

      assertOrderTransition('AWAITING_PAYMENT', 'ESCROW_HELD');
      const moved = await tx.order.updateMany({
        where: {
          id: input.payment.orderId,
          status: OrderStatus.AWAITING_PAYMENT,
        },
        data: { status: OrderStatus.ESCROW_HELD },
      });
      if (moved.count !== 1) throw new Error('Order changed concurrently');

      await tx.orderEvent.create({
        data: {
          orderId: input.payment.orderId,
          fromStatus: OrderStatus.AWAITING_PAYMENT,
          toStatus: OrderStatus.ESCROW_HELD,
          actorType: ActorType.SYSTEM,
          note: policyBlock
            ? `تم استلام الدفع عبر ${input.provider.name} وعزله للاسترداد الآلي`
            : `تم استلام الدفع عبر ${input.provider.name}`,
        },
      });

      if (policyBlock) {
        const failureCode = `${POST_CHECKOUT_POLICY_REFUND_PREFIX}${policyBlock}`;
        const refund = await tx.paymentRefund.create({
          data: {
            paymentId: input.payment.id,
            orderId: input.payment.orderId,
            amount: input.payment.amount,
            currency: input.payment.currency,
            requestedBy: 'edfapay-webhook',
            reasonCode: POST_CHECKOUT_POLICY_REFUND_REASON,
            status: PaymentRefundStatus.REQUESTED,
            failureCode,
          },
          select: { id: true },
        });
        await tx.auditLog.create({
          data: {
            actorType: ActorType.SYSTEM,
            action: 'payment.capture.policy_refund_requested',
            entityType: 'payment_refund',
            entityId: refund.id,
            after: {
              paymentId: input.payment.id,
              provider: input.provider.name,
              failureCode,
            },
          },
        });
        return 'POLICY_REFUND_REQUESTED' as const;
      }

      assertOrderTransition('ESCROW_HELD', 'AWAITING_SUPPLIER_CONFIRMATION');
      const queued = await tx.order.updateMany({
        where: {
          id: input.payment.orderId,
          supplierId: currentOrder.supplierId,
          status: OrderStatus.ESCROW_HELD,
        },
        data: { status: OrderStatus.AWAITING_SUPPLIER_CONFIRMATION },
      });
      if (queued.count !== 1) {
        throw new Error('Paid order could not enter supplier confirmation');
      }

      await tx.orderEvent.create({
        data: {
          orderId: input.payment.orderId,
          fromStatus: OrderStatus.ESCROW_HELD,
          toStatus: OrderStatus.AWAITING_SUPPLIER_CONFIRMATION,
          actorType: ActorType.SYSTEM,
          note: 'تم إرسال الطلب المدفوع إلى المورد للتأكيد',
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: ActorType.SYSTEM,
          action: 'order.supplier_confirmation.requested',
          entityType: 'order',
          entityId: input.payment.orderId,
          before: { status: OrderStatus.ESCROW_HELD },
          after: {
            status: OrderStatus.AWAITING_SUPPLIER_CONFIRMATION,
            paymentId: input.payment.id,
            provider: input.provider.name,
          },
        },
      });
      return 'APPLIED' as const;
    });
    return settlement;
  } catch (error) {
    if (error instanceof CaptureAlreadyApplied) return 'ALREADY_APPLIED';
    throw error;
  }
}
