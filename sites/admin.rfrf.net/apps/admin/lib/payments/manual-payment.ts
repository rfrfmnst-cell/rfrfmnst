import {
  ActorType,
  EscrowEntryType,
  OrderStatus,
  PaymentStatus,
  prisma,
} from '@rafraf/db';
import {
  ACTIVE_PAYMENT_INTAKE_STATUSES,
  orderPaymentIntakeLockKey,
} from '@rafraf/shared/payments/payment-intake';
import { manualPaymentDecision } from '@rafraf/shared/payments/manual-payment-policy';
import { assertOrderTransition } from '@rafraf/shared/workflow/order-state';

export type RecordManualPaymentOutcome =
  'RECORDED' | 'BLOCKED' | 'NOT_ACTIONABLE';

/**
 * The policy currently rejects every manual method before this module can
 * create a CAPTURED payment or escrow HOLD. The transactional branch remains
 * the future boundary after verified settlement and refund workflows exist.
 */
export async function recordManualPayment(
  input: {
    orderId: string;
    actorId: string;
    method: unknown;
    bankReference: unknown;
  },
  client: typeof prisma = prisma,
): Promise<RecordManualPaymentOutcome> {
  const decision = manualPaymentDecision(input.method, input.bankReference);
  if (!decision.allowed) {
    await client.auditLog.create({
      data: {
        actorId: input.actorId,
        actorType: ActorType.ADMIN,
        action: 'order.payment.manual.blocked',
        entityType: 'order',
        entityId: input.orderId,
        after: {
          method: decision.method,
          reason: decision.reason,
        },
      },
    });
    return 'BLOCKED';
  }

  return client.$transaction(async (tx) => {
    const lockKey = orderPaymentIntakeLockKey(input.orderId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: {
        payments: {
          where: { status: { in: [...ACTIVE_PAYMENT_INTAKE_STATUSES] } },
          select: { id: true },
          take: 1,
        },
        escrow: {
          where: { entryType: EscrowEntryType.HOLD },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (
      !order ||
      !order.supplierId ||
      order.status !== OrderStatus.AWAITING_PAYMENT ||
      order.payments.length > 0 ||
      order.escrow.length > 0
    ) {
      return 'NOT_ACTIONABLE';
    }

    const payment = await tx.payment.create({
      data: {
        orderId: input.orderId,
        provider: decision.provider,
        status: PaymentStatus.CAPTURED,
        amount: order.totalAmount,
        currency: order.currency,
        externalRef: decision.externalRef,
      },
      select: { id: true },
    });
    await tx.escrowLedgerEntry.create({
      data: {
        orderId: input.orderId,
        paymentId: payment.id,
        supplierId: order.supplierId,
        entryType: EscrowEntryType.HOLD,
        amount: order.totalAmount,
        currency: order.currency,
        note: 'تحويل بنكي موثق بمرجع — محتجز حتى التسليم',
        createdBy: input.actorId,
      },
    });

    assertOrderTransition('AWAITING_PAYMENT', 'ESCROW_HELD');
    const updated = await tx.order.updateMany({
      where: {
        id: input.orderId,
        status: OrderStatus.AWAITING_PAYMENT,
      },
      data: { status: OrderStatus.ESCROW_HELD },
    });
    if (updated.count !== 1) throw new Error('Order changed concurrently');
    await tx.orderEvent.create({
      data: {
        orderId: input.orderId,
        fromStatus: OrderStatus.AWAITING_PAYMENT,
        toStatus: OrderStatus.ESCROW_HELD,
        actorId: input.actorId,
        actorType: ActorType.ADMIN,
        note: 'تم استلام التحويل البنكي بمرجع موثق',
      },
    });

    assertOrderTransition('ESCROW_HELD', 'AWAITING_SUPPLIER_CONFIRMATION');
    const queued = await tx.order.updateMany({
      where: {
        id: input.orderId,
        supplierId: order.supplierId,
        status: OrderStatus.ESCROW_HELD,
      },
      data: { status: OrderStatus.AWAITING_SUPPLIER_CONFIRMATION },
    });
    if (queued.count !== 1) {
      throw new Error('Paid order could not enter supplier confirmation');
    }
    await tx.orderEvent.create({
      data: {
        orderId: input.orderId,
        fromStatus: OrderStatus.ESCROW_HELD,
        toStatus: OrderStatus.AWAITING_SUPPLIER_CONFIRMATION,
        actorId: input.actorId,
        actorType: ActorType.ADMIN,
        note: 'تم إرسال الطلب المدفوع إلى المورد للتأكيد',
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorType: ActorType.ADMIN,
        action: 'order.paid.manual',
        entityType: 'order',
        entityId: input.orderId,
        before: { status: order.status },
        after: {
          method: decision.method,
          evidenceType: 'BANK_TRANSACTION_REFERENCE',
          referenceStored: true,
          status: OrderStatus.AWAITING_SUPPLIER_CONFIRMATION,
        },
      },
    });
    return 'RECORDED';
  });
}
