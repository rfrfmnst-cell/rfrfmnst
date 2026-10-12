import { ActorType, OrderStatus, prisma } from '@rafraf/db';
import {
  ACTIVE_PAYMENT_INTAKE_STATUSES,
  orderPaymentIntakeLockKey,
} from '@rafraf/shared/payments/payment-intake';

export function formatCustomerOrderTotal(
  amount: { toFixed(fractionDigits: number): string },
  currency: string,
): string {
  return `${amount.toFixed(2)} ${currency}`;
}

export interface CustomerOrderCancellationInput {
  orderId: string;
  customerId: string;
}

export interface CustomerOrderCancellationResult {
  outcome: 'CANCELLED' | 'REPLAYED' | 'NOT_CANCELLABLE' | 'NOT_FOUND';
}

export function canCancelDeferredCustomerOrder(input: {
  orderStatus: string;
  paymentKind: 'checkout' | 'deferred';
  activePayment: boolean;
}): boolean {
  return (
    input.orderStatus === OrderStatus.AWAITING_PAYMENT &&
    input.paymentKind === 'deferred' &&
    !input.activePayment
  );
}

/**
 * إلغاء مملوك قبل الدفع. updateMany هو CAS على المالك والحالة معاً؛ لذلك لا
 * يستطيع إلا طلب واحد إنشاء حدث الإلغاء، بينما تعيد الإعادات اللاحقة replay.
 */
export async function cancelAwaitingPaymentOrder(
  input: CustomerOrderCancellationInput,
  client: typeof prisma = prisma,
): Promise<CustomerOrderCancellationResult> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order-financial-resolution:${input.orderId}`}))`;
    const intakeLock = orderPaymentIntakeLockKey(input.orderId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${intakeLock}))`;

    const updated = await tx.order.updateMany({
      where: {
        id: input.orderId,
        customerId: input.customerId,
        status: OrderStatus.AWAITING_PAYMENT,
        payments: {
          none: {
            provider: { not: 'MOCK' },
            status: { in: [...ACTIVE_PAYMENT_INTAKE_STATUSES] },
          },
        },
      },
      data: { status: OrderStatus.CANCELLED },
    });

    if (updated.count === 1) {
      await tx.orderEvent.create({
        data: {
          orderId: input.orderId,
          fromStatus: OrderStatus.AWAITING_PAYMENT,
          toStatus: OrderStatus.CANCELLED,
          actorType: ActorType.CUSTOMER,
          actorId: input.customerId,
          note: 'إلغاء العميل قبل الدفع',
        },
      });
      return { outcome: 'CANCELLED' };
    }

    const ownedOrder = await tx.order.findFirst({
      where: { id: input.orderId, customerId: input.customerId },
      select: { status: true },
    });
    if (!ownedOrder) return { outcome: 'NOT_FOUND' };
    if (ownedOrder.status === OrderStatus.CANCELLED) {
      return { outcome: 'REPLAYED' };
    }
    return { outcome: 'NOT_CANCELLABLE' };
  });
}
