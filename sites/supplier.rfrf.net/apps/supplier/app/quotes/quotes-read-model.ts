import { Prisma, QuoteStatus, prisma } from '@rafraf/db';
import { resolveSupplierRfqScope } from '@rafraf/shared/product-os/sourcing-market';
import { SUPPLIER_ELIGIBLE_RFQ_ITEM_WHERE } from '../../lib/rfq-opportunity-policy';

const PAGE_SIZE = 24;

const FILTER_TO_QUOTE_STATUS: Record<string, QuoteStatus> = {
  DRAFT: QuoteStatus.DRAFT,
  ACTIVE: QuoteStatus.ACTIVE,
  APPROVED: QuoteStatus.APPROVED,
  SELECTED: QuoteStatus.SELECTED,
};

const FILTER_STATUSES = new Set([
  'ALL',
  'OPEN',
  ...Object.keys(FILTER_TO_QUOTE_STATUS),
]);

export type SupplierQuotesSearchParams = {
  q?: string;
  status?: string;
  page?: string;
  ok?: string;
  err?: string;
};

function parsePage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function supplierQuotesPageHref(
  query: string,
  normalizedStatus: string,
  targetPage: number,
) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (normalizedStatus !== 'ALL') params.set('status', normalizedStatus);
  params.set('page', String(targetPage));
  return `/quotes?${params.toString()}`;
}

export async function loadSupplierQuotesReadModel({
  params,
  supplierId,
}: {
  params: SupplierQuotesSearchParams;
  supplierId: string;
}) {
  const { q = '', status = 'ALL', page: requestedPageValue, ok, err } = params;
  const query = q.trim().slice(0, 120);
  const normalizedStatus = FILTER_STATUSES.has(status) ? status : 'ALL';
  const filterQuoteStatus = FILTER_TO_QUOTE_STATUS[normalizedStatus];
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { countryCode: true },
  });
  const scope = resolveSupplierRfqScope(supplier?.countryCode);
  const supplierQuoteWhere: Prisma.QuoteWhereInput = scope
    ? { supplierId, sourceType: scope.quoteSourceType }
    : { id: { in: [] } };

  const baseOpportunityWhere: Prisma.RFQItemWhereInput = {
    AND: [
      SUPPLIER_ELIGIBLE_RFQ_ITEM_WHERE,
      scope ? { rfq: { status: scope.rfqStatus } } : { id: { in: [] } },
    ],
  };
  const searchWhere: Prisma.RFQItemWhereInput | null = query
    ? {
        OR: [
          { freeTextAr: { contains: query, mode: 'insensitive' } },
          { oemNumber: { contains: query, mode: 'insensitive' } },
          { rfq: { code: { contains: query, mode: 'insensitive' } } },
        ],
      }
    : null;

  const opportunityClauses: Prisma.RFQItemWhereInput[] = [];
  if (normalizedStatus === 'OPEN') {
    opportunityClauses.push(baseOpportunityWhere, {
      quotes: { none: { supplierId } },
    });
  } else if (filterQuoteStatus) {
    // السجل التاريخي يعتمد على عرض المورد نفسه، لا على بقاء RFQ في طور التوريد.
    opportunityClauses.push({
      quotes: {
        some: { ...supplierQuoteWhere, status: filterQuoteStatus },
      },
    });
  } else {
    opportunityClauses.push({
      OR: [baseOpportunityWhere, { quotes: { some: supplierQuoteWhere } }],
    });
  }
  if (searchWhere) opportunityClauses.push(searchWhere);

  const opportunityWhere: Prisma.RFQItemWhereInput = {
    AND: opportunityClauses,
  };

  const [totalFiltered, availableCount, fitmentAggregate, quoteStatusGroups] =
    await Promise.all([
      prisma.rFQItem.count({ where: opportunityWhere }),
      prisma.rFQItem.count({
        where: {
          AND: [baseOpportunityWhere, { quotes: { none: { supplierId } } }],
        },
      }),
      prisma.rFQItem.aggregate({
        where: baseOpportunityWhere,
        _avg: { fitmentConfidence: true },
      }),
      prisma.quote.groupBy({
        by: ['status'],
        where: supplierQuoteWhere,
        _count: { _all: true },
      }),
    ]);

  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const currentPage = Math.min(parsePage(requestedPageValue), totalPages);
  const pageItems = await prisma.rFQItem.findMany({
    where: opportunityWhere,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (currentPage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: {
      rfq: {
        include: {
          customer: { select: { city: true } },
          vehicle: { select: { make: true, model: true, year: true } },
        },
      },
    },
  });

  const visibleItemIds = pageItems.map((item) => item.id);
  const visibleQuotes =
    visibleItemIds.length && normalizedStatus !== 'OPEN'
      ? await prisma.quote.findMany({
          where: {
            ...supplierQuoteWhere,
            rfqItemId: { in: visibleItemIds },
            ...(filterQuoteStatus ? { status: filterQuoteStatus } : {}),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          include: {
            landedCost: { select: { supplierPrice: true } },
          },
        })
      : [];

  // Newest quote wins for display if legacy data contains more than one quote
  // for the same supplier/item pair. The write action still blocks new duplicates.
  const quotedByItem = new Map<string, (typeof visibleQuotes)[number]>();
  for (const quote of visibleQuotes) {
    if (!quotedByItem.has(quote.rfqItemId)) {
      quotedByItem.set(quote.rfqItemId, quote);
    }
  }

  const countQuotes = (quoteStatus: QuoteStatus) =>
    quoteStatusGroups.find((group) => group.status === quoteStatus)?._count
      ._all ?? 0;
  const draftCount = countQuotes(QuoteStatus.DRAFT);
  const activeCount = countQuotes(QuoteStatus.ACTIVE);
  const wonCount = countQuotes(QuoteStatus.SELECTED);
  const avgFitment = Math.round(
    (fitmentAggregate._avg.fitmentConfidence ?? 0) * 100,
  );
  const firstResult =
    totalFiltered === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const lastResult = Math.min(currentPage * PAGE_SIZE, totalFiltered);
  const pageWindowStart = Math.min(
    Math.max(1, currentPage - 2),
    Math.max(1, totalPages - 4),
  );
  const pageNumbers = Array.from(
    { length: Math.min(5, totalPages) },
    (_, index) => pageWindowStart + index,
  );

  return {
    activeCount,
    availableCount,
    avgFitment,
    currentPage,
    draftCount,
    err,
    firstResult,
    lastResult,
    normalizedStatus,
    ok,
    pageItems,
    pageNumbers,
    query,
    quotedByItem,
    totalFiltered,
    totalPages,
    wonCount,
  };
}

export type SupplierQuotesReadModel = Awaited<
  ReturnType<typeof loadSupplierQuotesReadModel>
>;
