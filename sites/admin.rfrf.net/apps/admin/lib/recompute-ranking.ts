import {
  Prisma,
  QuoteSourceType,
  QuoteStatus,
  RecommendationLabel,
  RiskLevel,
} from '@rafraf/db';
import {
  rankQuoteSet,
  type QuoteMetrics,
} from '@rafraf/shared/pricing/decision-score';
import { lockReviewedRisks } from '@rafraf/orders/src/risk-assessment-writer.ts';
import {
  filterCustomerOfferCandidates,
  loadCustomerOfferRiskLevels,
} from './customer-offer-visibility.ts';

export interface QuoteRankingSnapshot {
  id: string;
  decisionScore: number | null;
  labels: RecommendationLabel[];
}

export interface RankingCommit {
  quoteSnapshots: QuoteRankingSnapshot[];
  recommendationResultId: string;
  bestOverallQuoteId: string | null;
}

/**
 * يعيد احتساب درجات وترشيحات عنصر RFQ داخل نفس المعاملة التي غيّرت عروضه.
 * إبقاء الحساب داخل TransactionClient يمنع ظهور توصيات قديمة بين رفض عرض واعتماد بديله.
 */
export async function recomputeRankingInTransaction(
  tx: Prisma.TransactionClient,
  rfqItemId: string,
): Promise<RankingCommit | null> {
  const quoteQuery = {
    where: { rfqItemId, status: { not: QuoteStatus.REJECTED } },
    include: { supplier: true },
    orderBy: { id: 'asc' as const },
  };
  const [item, candidates] = await Promise.all([
    tx.rFQItem.findUnique({
      where: { id: rfqItemId },
      select: {
        partId: true,
        fitmentConfidence: true,
        humanReviewRequired: true,
        rfq: { select: { status: true } },
        part: {
          select: {
            isRestricted: true,
            sensitivity: true,
            category: { select: { isRestricted: true, sensitivity: true } },
          },
        },
      },
    }),
    tx.quote.findMany(quoteQuery),
  ]);

  // Callers hold the RFQ decision lock before writing/reviewing a quote.
  // Lock the whole candidate risk set in the same quote-then-supplier order
  // as commerce approval, then read the committed facts through this tx.
  for (const quoteId of [...new Set(candidates.map((q) => q.id))].sort()) {
    await lockReviewedRisks(tx, { quoteId });
  }
  const supplierIds = new Set(
    candidates.flatMap((q) => (q.supplierId ? [q.supplierId] : [])),
  );
  for (const supplierId of [...supplierIds].sort()) {
    await lockReviewedRisks(tx, { supplierId });
  }
  const allQuotes = await tx.quote.findMany(quoteQuery);
  const { quoteRisks, supplierRisks } = await loadCustomerOfferRiskLevels(
    allQuotes,
    tx,
  );

  const quoteSnapshots: QuoteRankingSnapshot[] = allQuotes.map((quote) => ({
    id: quote.id,
    decisionScore: quote.decisionScore,
    labels: quote.labels,
  }));

  const now = new Date();
  const quotes = item
    ? filterCustomerOfferCandidates({
        quotes: allQuotes,
        item,
        part: item.part,
        rfqStatus: item.rfq.status,
        quoteRisks,
        supplierRisks,
        now,
      })
    : [];

  const rankableIds = new Set(quotes.map((quote) => quote.id));
  for (const quote of allQuotes) {
    if (
      !rankableIds.has(quote.id) &&
      (quote.decisionScore != null || quote.labels.length > 0)
    ) {
      await tx.quote.update({
        where: { id: quote.id },
        data: { decisionScore: null, labels: [] },
      });
    }
  }
  if (!item) return null;

  const metrics: QuoteMetrics[] = quotes.map((quote) => ({
    quoteId: quote.id,
    fitmentConfidence: quote.fitmentConfidence ?? undefined,
    supplierScore: quote.supplier?.score ?? 80,
    price: Number(quote.finalPrice),
    deliveryDays: quote.deliveryDaysMax ?? undefined,
    warrantyMonths: quote.warrantyMonths,
    counterfeitRisk: quote.riskLevel === RiskLevel.MEDIUM ? 0.2 : 0,
    complianceRisk: quote.sourceType === QuoteSourceType.GLOBAL ? 0.1 : 0,
    supplierReturnRate: quote.supplier?.returnRate ?? 0,
  }));

  const ranked = rankQuoteSet(metrics);
  const labelByQuote = new Map<string, RecommendationLabel[]>();
  for (const [label, quoteId] of Object.entries(ranked.labels)) {
    if (!quoteId) continue;
    const typedLabel = label as RecommendationLabel;
    labelByQuote.set(quoteId, [
      ...(labelByQuote.get(quoteId) ?? []),
      typedLabel,
    ]);
  }

  for (const scored of ranked.scored) {
    await tx.quote.update({
      where: { id: scored.quoteId },
      data: {
        decisionScore: scored.decisionScore,
        labels: labelByQuote.get(scored.quoteId) ?? [],
      },
    });
  }

  const previous = await tx.recommendationResult.findFirst({
    where: { rfqItemId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { createdAt: true },
  });
  const recommendation = await tx.recommendationResult.create({
    data: {
      rfqItemId,
      bestOverallQuoteId: ranked.labels.BEST_OVERALL ?? null,
      cheapestQuoteId: ranked.labels.CHEAPEST ?? null,
      fastestQuoteId: ranked.labels.FASTEST ?? null,
      highestWarrantyQuoteId: ranked.labels.HIGHEST_WARRANTY ?? null,
      lowestRiskQuoteId: ranked.labels.LOWEST_RISK ?? null,
      explanationAr: buildExplanation(ranked, quotes),
      scoreVector: ranked.scored as unknown as Prisma.InputJsonValue,
      // PostgreSQL now() reflects transaction start, before a waited RFQ lock.
      createdAt: new Date(
        Math.max(Date.now(), (previous?.createdAt.getTime() ?? 0) + 1),
      ),
    },
  });

  return {
    quoteSnapshots,
    recommendationResultId: recommendation.id,
    bestOverallQuoteId: ranked.labels.BEST_OVERALL ?? null,
  };
}

function buildExplanation(
  ranked: ReturnType<typeof rankQuoteSet>,
  quotes: { id: string; supplier: { businessName: string } | null }[],
): string {
  const supplierName = (quoteId?: string) =>
    quotes.find((quote) => quote.id === quoteId)?.supplier?.businessName ??
    'العرض';

  const best = ranked.labels.BEST_OVERALL;
  if (!best)
    return 'لا توجد عروض مؤهلة للتوصية حالياً؛ يلزم استكمال مراجعة الأهلية.';
  const cheapest = ranked.labels.CHEAPEST;
  if (best && cheapest && best !== cheapest) {
    return `نرشّح «${supplierName(best)}» لأعلى توازن بين التوافق والمورد والمدة والضمان، رغم أن «${supplierName(cheapest)}» أرخص — الفرق لا يبرّر التنازل عن الموثوقية.`;
  }
  return `نرشّح «${supplierName(best)}» كأفضل خيار إجمالي.`;
}
