import { OrderStatus, prisma } from '@rafraf/db';
import {
  COMPLIANCE_REVIEW_ORDER_STATUSES,
  ORDER_COMPLIANCE_SELECT,
  orderComplianceStatus,
} from '@rafraf/shared/workflow/order-compliance';

/** Includes missing cases and stale approvals; do not silently cap the count. */
export async function getComplianceQueue(client = prisma) {
  const queue: {
    id: string;
    code: string;
    rfqId: string | null;
    reason: string;
  }[] = [];
  let cursor: string | undefined;
  for (;;) {
    const orders = await client.order.findMany({
      where: {
        status: { in: [...COMPLIANCE_REVIEW_ORDER_STATUSES] as OrderStatus[] },
      },
      orderBy: { id: 'asc' },
      take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, code: true, rfqId: true, ...ORDER_COMPLIANCE_SELECT },
    });
    for (const order of orders) {
      const state = orderComplianceStatus(order);
      if (!state.cleared)
        queue.push({
          id: order.id,
          code: order.code,
          rfqId: order.rfqId,
          reason: state.reason!,
        });
    }
    if (orders.length < 200) return queue;
    cursor = orders.at(-1)!.id;
  }
}
