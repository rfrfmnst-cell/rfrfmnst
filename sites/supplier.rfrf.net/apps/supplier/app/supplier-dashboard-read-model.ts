import { prisma } from '@rafraf/db';
import { resolveSupplierRfqScope } from '@rafraf/shared/product-os/sourcing-market';
import { SUPPLIER_VISIBLE_ORDER_STATUSES } from '@rafraf/shared/workflow/supplier-order-visibility';
import { SUPPLIER_ELIGIBLE_RFQ_ITEM_WHERE } from '../lib/rfq-opportunity-policy.ts';

export async function loadSupplierAccount(supplierId: string) {
  return prisma.supplier.findUnique({
    where: { id: supplierId },
    select: {
      id: true,
      businessName: true,
      city: true,
      countryCode: true,
      status: true,
      documents: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, type: true, status: true, createdAt: true },
      },
    },
  });
}

export type SupplierAccount = NonNullable<
  Awaited<ReturnType<typeof loadSupplierAccount>>
>;

export async function loadSupplierDashboardReadModel(
  supplier: SupplierAccount,
) {
  const eligibleItemWhere = SUPPLIER_ELIGIBLE_RFQ_ITEM_WHERE;
  const scope = resolveSupplierRfqScope(supplier.countryCode);
  const supplierQuoteWhere = scope
    ? { supplierId: supplier.id, sourceType: scope.quoteSourceType }
    : { id: { in: [] } };

  const rfqs = scope
    ? await prisma.rFQ.findMany({
        where: {
          status: scope.rfqStatus,
          items: { some: eligibleItemWhere },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          // سرية: مدينة العميل فقط — لا اسم ولا جوال ولا عروض موردين آخرين.
          // المركبة: الطراز فقط (لا VIN/لوحة — بيانات عميل لا يراها المورد).
          customer: { select: { city: true } },
          vehicle: { select: { make: true, model: true, year: true } },
          items: {
            where: eligibleItemWhere,
            orderBy: { createdAt: 'asc' },
          },
        },
      })
    : [];

  const visibleItemIds = rfqs.flatMap((rfq) =>
    rfq.items.map((item) => item.id),
  );
  const [
    visibleQuotes,
    recentQuotes,
    quoteStatusGroups,
    inventory,
    payouts,
    orders,
  ] = await Promise.all([
    visibleItemIds.length
      ? prisma.quote.findMany({
          where: {
            ...supplierQuoteWhere,
            rfqItemId: { in: visibleItemIds },
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true, rfqItemId: true },
        })
      : Promise.resolve([]),
    prisma.quote.findMany({
      where: supplierQuoteWhere,
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        code: true,
        rfqItemId: true,
        status: true,
        finalPrice: true,
        deliveryDaysMin: true,
        warrantyMonths: true,
        landedCost: { select: { supplierPrice: true } },
        rfqItem: { select: { freeTextAr: true } },
      },
    }),
    prisma.quote.groupBy({
      by: ['status'],
      where: supplierQuoteWhere,
      _count: { _all: true },
    }),
    prisma.supplierInventory.findMany({
      where: { supplierId: supplier.id },
      take: 5,
    }),
    prisma.supplierPayout.findMany({
      where: { supplierId: supplier.id },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.order.findMany({
      where: {
        supplierId: supplier.id,
        status: { in: [...SUPPLIER_VISIBLE_ORDER_STATUSES] },
      },
      include: { shipments: true, quote: { include: { rfqItem: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  const quotedItems = new Set(visibleQuotes.map((quote) => quote.rfqItemId));
  const countQuotes = (status: string) =>
    quoteStatusGroups.find((group) => group.status === status)?._count._all ??
    0;
  const totalQuoteCount = quoteStatusGroups.reduce(
    (sum, group) => sum + group._count._all,
    0,
  );
  const availableCount = rfqs.reduce(
    (count, rfq) =>
      count + rfq.items.filter((item) => !quotedItems.has(item.id)).length,
    0,
  );
  const approvedQuotes = countQuotes('APPROVED') + countQuotes('SELECTED');

  return {
    approvedQuotes,
    availableCount,
    inventory,
    orders,
    payouts,
    quotedItems,
    recentQuotes,
    rfqs,
    totalQuoteCount,
  };
}

export type SupplierDashboardReadModel = Awaited<
  ReturnType<typeof loadSupplierDashboardReadModel>
>;
