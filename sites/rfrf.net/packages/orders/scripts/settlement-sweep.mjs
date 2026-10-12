import { ActorType, OrderStatus, prisma } from '@rafraf/db';
import { resolveComplaintWindowHours } from '@rafraf/shared/workflow/order-settlement';
import { settleDeliveredOrder } from '../src/settlement.ts';

const hours = resolveComplaintWindowHours(process.env.COMPLAINT_WINDOW_HOURS);
const now = new Date();
const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);
const limit = 50;

try {
  const candidates = await prisma.order.findMany({
    where: {
      status: OrderStatus.COMPLAINT_WINDOW,
      deliveredAt: { not: null, lte: cutoff },
    },
    orderBy: [{ deliveredAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
    take: limit,
  });

  const outcomes = new Map();
  for (const candidate of candidates) {
    const result = await settleDeliveredOrder({
      orderId: candidate.id,
      actorId: 'settlement-sweep',
      actorType: ActorType.SYSTEM,
      now,
    });
    outcomes.set(result.outcome, (outcomes.get(result.outcome) ?? 0) + 1);
  }

  console.log(
    JSON.stringify({
      scanned: candidates.length,
      limit,
      outcomes: Object.fromEntries(outcomes),
    }),
  );
} finally {
  await prisma.$disconnect();
}
