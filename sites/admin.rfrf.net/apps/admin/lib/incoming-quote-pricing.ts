import {
  ActorType,
  Prisma,
  QuoteStatus,
  RFQStatus,
  RiskLevel,
  prisma,
} from '@rafraf/db';
import { isPartCommerceRestricted } from '@rafraf/shared/product-os/part-restriction';
import { rfqDecisionLockKey } from '@rafraf/shared/product-os/rfq-decision-lock';
import {
  boundedFitmentConfidence,
  isVerifiedFitment,
} from '@rafraf/shared/product-os/quote-policy';
import { computeLandedCost } from '@rafraf/shared/pricing/landed-cost';
import { recomputeRankingInTransaction } from './recompute-ranking.ts';
import { recordReviewedRisk } from '@rafraf/orders/src/risk-assessment-writer.ts';

export interface IncomingQuotePricingInput {
  actorId: string;
  quoteId: string;
  rfqId: string;
  localShipping: number;
  riskBuffer: number;
  platformMargin: number;
  fitmentConfidence: number;
  riskLevel: string;
  vatRate: number;
}

export type IncomingQuotePricingResult =
  | { outcome: 'APPLIED'; quoteId: string; totalAmount: string }
  | {
      outcome:
        | 'NOT_AVAILABLE'
        | 'NOT_DRAFT'
        | 'RFQ_MISMATCH'
        | 'RFQ_NOT_PRICEABLE'
        | 'RFQ_CHANGED'
        | 'INVALID_PRICING_INPUT'
        | 'SUPPLIER_NOT_APPROVED'
        | 'FITMENT_REQUIRED'
        | 'PART_RESTRICTED';
    };

type RecomputeRanking = typeof recomputeRankingInTransaction;

const MAX_DECIMAL_12_2 = 9_999_999_999.99;
const PRICEABLE_RFQ_STATUSES = new Set<RFQStatus>([
  RFQStatus.SOURCING_LOCAL,
  RFQStatus.SOURCING_GLOBAL,
  RFQStatus.QUOTES_READY,
]);

function isCurrencyAmount(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_DECIMAL_12_2 &&
    Number(value.toFixed(2)) === value
  );
}

export function isRiskLevel(value: string): value is RiskLevel {
  return (
    value === RiskLevel.LOW ||
    value === RiskLevel.MEDIUM ||
    value === RiskLevel.HIGH ||
    value === RiskLevel.BLOCKED
  );
}

export function isPriceableRfqStatus(status: RFQStatus): boolean {
  return PRICEABLE_RFQ_STATUSES.has(status);
}

export function parseIncomingQuoteCurrencyAmount(value: unknown): number {
  if (typeof value !== 'string') return Number.NaN;
  const canonical = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(canonical)) {
    return Number.NaN;
  }
  return Number(canonical);
}

/**
 * Reviews and prices one supplier DRAFT inside one transaction. The admin
 * action owns authentication/revalidation; this service owns the auditable
 * DRAFT -> ACTIVE and RFQ -> QUOTES_READY domain transition.
 */
export async function priceIncomingSupplierQuote(
  input: IncomingQuotePricingInput,
  client: typeof prisma = prisma,
  recomputeRanking: RecomputeRanking = recomputeRankingInTransaction,
): Promise<IncomingQuotePricingResult> {
  const riskLevel = input.riskLevel;
  if (
    !isCurrencyAmount(input.localShipping) ||
    !isCurrencyAmount(input.riskBuffer) ||
    !isCurrencyAmount(input.platformMargin) ||
    !isRiskLevel(riskLevel)
  ) {
    return { outcome: 'INVALID_PRICING_INPUT' };
  }

  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${rfqDecisionLockKey(input.rfqId)}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`incoming-quote-pricing:${input.quoteId}`}))`;

    const quote = await tx.quote.findUnique({
      where: { id: input.quoteId },
      include: {
        supplier: { select: { status: true } },
        rfqItem: {
          select: {
            rfqId: true,
            partId: true,
            fitmentConfidence: true,
            humanReviewRequired: true,
            rfq: { select: { status: true, updatedAt: true } },
            part: {
              select: {
                isRestricted: true,
                sensitivity: true,
                category: {
                  select: { isRestricted: true, sensitivity: true },
                },
              },
            },
          },
        },
      },
    });
    if (!quote) return { outcome: 'NOT_AVAILABLE' };
    if (quote.rfqItem.rfqId !== input.rfqId) {
      return { outcome: 'RFQ_MISMATCH' };
    }
    if (quote.status !== QuoteStatus.DRAFT) return { outcome: 'NOT_DRAFT' };
    if (!PRICEABLE_RFQ_STATUSES.has(quote.rfqItem.rfq.status)) {
      return { outcome: 'RFQ_NOT_PRICEABLE' };
    }
    if (!quote.supplierId || quote.supplier?.status !== 'APPROVED') {
      return { outcome: 'SUPPLIER_NOT_APPROVED' };
    }
    if (!isVerifiedFitment(quote.rfqItem)) {
      return { outcome: 'FITMENT_REQUIRED' };
    }
    if (isPartCommerceRestricted(quote.rfqItem.part)) {
      return { outcome: 'PART_RESTRICTED' };
    }

    const supplierPrice = Number(quote.finalPrice);
    const landedCost = computeLandedCost({
      supplierPrice,
      localShipping: input.localShipping,
      riskBuffer: input.riskBuffer,
      platformMargin: input.platformMargin,
      vatRate: input.vatRate,
      warrantyMonths: quote.warrantyMonths,
      currency: quote.currency,
    });
    const effectiveFitment = boundedFitmentConfidence(
      input.fitmentConfidence,
      quote.rfqItem.fitmentConfidence,
    );
    if (!isCurrencyAmount(landedCost.totalLandedCost)) {
      return { outcome: 'INVALID_PRICING_INPUT' };
    }

    const rfqUpdated = await tx.rFQ.updateMany({
      where: {
        id: input.rfqId,
        status: quote.rfqItem.rfq.status,
        updatedAt: quote.rfqItem.rfq.updatedAt,
      },
      data: { status: RFQStatus.QUOTES_READY },
    });
    if (rfqUpdated.count !== 1) return { outcome: 'RFQ_CHANGED' };

    await tx.quote.update({
      where: { id: quote.id },
      data: {
        partId: quote.rfqItem.partId,
        finalPrice: new Prisma.Decimal(landedCost.totalLandedCost),
        fitmentConfidence: effectiveFitment,
        riskLevel,
        status: QuoteStatus.ACTIVE,
        landedCost: {
          create: {
            supplierPrice: new Prisma.Decimal(supplierPrice),
            localShipping: new Prisma.Decimal(input.localShipping),
            riskBuffer: new Prisma.Decimal(input.riskBuffer),
            platformMargin: new Prisma.Decimal(input.platformMargin),
            taxAmount: new Prisma.Decimal(
              landedCost.internalCostBreakdown.taxAmount,
            ),
            totalLandedCost: new Prisma.Decimal(landedCost.totalLandedCost),
            customerVisibleBreakdown:
              landedCost.customerVisibleBreakdown as unknown as Prisma.InputJsonValue,
            internalCostBreakdown:
              landedCost.internalCostBreakdown as unknown as Prisma.InputJsonValue,
          },
        },
      },
    });
    const riskAssessmentId = await recordReviewedRisk(tx, {
      entityType: 'quote',
      entityId: quote.id,
      actorId: input.actorId,
      riskLevel,
      reasonCode: 'QUOTE_REVIEW',
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorType: ActorType.ADMIN,
        action: 'quote.priced.from_supplier_draft',
        entityType: 'quote',
        entityId: quote.id,
        after: {
          riskAssessmentId,
          supplierPrice,
          landed: landedCost.totalLandedCost,
          partId: quote.rfqItem.partId,
          fitmentConfidence: effectiveFitment,
        },
      },
    });
    await recomputeRanking(tx, quote.rfqItemId);
    return {
      outcome: 'APPLIED',
      quoteId: quote.id,
      totalAmount: landedCost.totalLandedCost.toFixed(2),
    };
  });
}
