import { ActorType, DisputeStatus, OrderStatus, prisma } from '@rafraf/db';
import { assertOrderTransition } from '@rafraf/shared/workflow/order-state';

export const CUSTOMER_DISPUTE_REASONS = {
  WRONG_PART: 'القطعة غير مطابقة',
  DAMAGED: 'القطعة متضررة',
  NOT_AS_DESCRIBED: 'القطعة لا تطابق الوصف',
  MISSING_ITEMS: 'الشحنة ناقصة',
  OTHER: 'سبب آخر',
} as const;

export type CustomerDisputeReason = keyof typeof CUSTOMER_DISPUTE_REASONS;
export type OpenCustomerDisputeOutcome =
  'OPENED' | 'REPLAYED' | 'INVALID_INPUT' | 'NOT_ACTIONABLE' | 'NOT_FOUND';

export interface OpenCustomerDisputeResult {
  outcome: OpenCustomerDisputeOutcome;
  disputeId?: string;
}

export function parseCustomerDisputeReason(
  value: unknown,
): CustomerDisputeReason | null {
  return typeof value === 'string' &&
    Object.hasOwn(CUSTOMER_DISPUTE_REASONS, value)
    ? (value as CustomerDisputeReason)
    : null;
}

function cleanDescription(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/gu, ' ').trim().slice(0, 1_000);
  return clean.length >= 10 ? clean : null;
}

/** Opens a customer-owned complaint and its operational trail atomically. */
export async function openCustomerDispute(
  input: {
    orderId: string;
    customerId: string;
    reasonCode: unknown;
    description: unknown;
  },
  client: typeof prisma = prisma,
): Promise<OpenCustomerDisputeResult> {
  const reasonCode = parseCustomerDisputeReason(input.reasonCode);
  const description = cleanDescription(input.description);
  if (!reasonCode || !description) return { outcome: 'INVALID_INPUT' };

  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-dispute:${input.orderId}`}))`;
    const order = await tx.order.findFirst({
      where: { id: input.orderId, customerId: input.customerId },
      select: {
        id: true,
        status: true,
        disputes: {
          where: {
            status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] },
          },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!order) return { outcome: 'NOT_FOUND' };
    const existing = order.disputes[0];
    if (order.status === OrderStatus.DISPUTED && existing) {
      return { outcome: 'REPLAYED', disputeId: existing.id };
    }
    if (order.status !== OrderStatus.COMPLAINT_WINDOW || existing) {
      return { outcome: 'NOT_ACTIONABLE' };
    }

    assertOrderTransition('COMPLAINT_WINDOW', 'DISPUTED');
    const moved = await tx.order.updateMany({
      where: {
        id: order.id,
        customerId: input.customerId,
        status: OrderStatus.COMPLAINT_WINDOW,
      },
      data: { status: OrderStatus.DISPUTED },
    });
    if (moved.count !== 1) return { outcome: 'NOT_ACTIONABLE' };

    const dispute = await tx.dispute.create({
      data: {
        orderId: order.id,
        customerId: input.customerId,
        reason: reasonCode,
        description,
        status: DisputeStatus.OPEN,
      },
      select: { id: true },
    });
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        fromStatus: OrderStatus.COMPLAINT_WINDOW,
        toStatus: OrderStatus.DISPUTED,
        actorType: ActorType.CUSTOMER,
        actorId: input.customerId,
        note: `فتح العميل شكوى: ${CUSTOMER_DISPUTE_REASONS[reasonCode]}`,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.customerId,
        actorType: ActorType.CUSTOMER,
        action: 'dispute.customer.opened',
        entityType: 'dispute',
        entityId: dispute.id,
        before: { orderStatus: OrderStatus.COMPLAINT_WINDOW },
        after: {
          orderStatus: OrderStatus.DISPUTED,
          reasonCode,
          escrowAction: 'NONE',
        },
      },
    });
    return { outcome: 'OPENED', disputeId: dispute.id };
  });
}
