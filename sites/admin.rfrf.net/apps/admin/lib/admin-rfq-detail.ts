import { prisma } from '@rafraf/db';
import { ORDER_COMPLIANCE_SELECT } from '@rafraf/shared/workflow/order-compliance';
import { loadGlobalSourcingRunsForItem } from './global-sourcing/run-history';

export async function loadAdminRfqDetail(id: string) {
  const rfq = await prisma.rFQ.findUnique({
    where: { id },
    include: {
      customer: {
        include: {
          user: {
            select: {
              phone: true,
            },
          },
        },
      },
      vehicle: true,
      evidence: true,
      orders: {
        include: {
          payments: true,
          shipments: { orderBy: { updatedAt: 'desc' } },
          complianceCases: ORDER_COMPLIANCE_SELECT.complianceCases,
          quote: {
            include: {
              supplier: true,
              part: true,
              rfqItem: { include: { part: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
      items: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: {
          part: true,
          quotes: {
            where: { status: { not: 'REJECTED' } },
            orderBy: { decisionScore: 'desc' },
            include: { landedCost: true, supplier: true },
          },
          recommendations: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      },
    },
  });
  if (!rfq) return null;

  // The RFQ detail currently renders only its first item. Do not read history
  // for items that are not displayed, while keeping the existing typed shape.
  const firstItem = rfq.items[0];
  const sourcingRuns = firstItem
    ? await loadGlobalSourcingRunsForItem(firstItem.id, (query) =>
        prisma.sourcingRun.findFirst(query),
      )
    : [];
  return {
    ...rfq,
    items: rfq.items.map((item, index) => ({
      ...item,
      sourcingRuns: index === 0 ? sourcingRuns : [],
    })),
  };
}

export type AdminRfqDetail = NonNullable<
  Awaited<ReturnType<typeof loadAdminRfqDetail>>
>;
export type AdminRfqItem = AdminRfqDetail['items'][number];
