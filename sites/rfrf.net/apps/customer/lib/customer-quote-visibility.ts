import {
  reviewedCommerceRiskLevel,
  type CommerceRiskAssessment,
} from '@rafraf/shared/product-os/reviewed-commerce-risk';
import { Prisma, prisma } from '@rafraf/db';
import { isPartCommerceRestricted } from '@rafraf/shared/product-os/part-restriction';
import {
  isCustomerQuoteEligible,
  type CustomerQuoteEligibilityFacts,
} from '@rafraf/shared/product-os/customer-quote-eligibility';

interface CustomerVisibleQuoteCandidate {
  id: string;
  partId: string | null;
  fitmentConfidence: number | null;
  status: string;
  expiresAt: Date | null;
  riskLevel: string;
  finalPrice: unknown;
  supplier: { id?: string; status: string } | null;
}

/**
 * Loads only the bounded recent risk window and keeps the newest row per quote.
 * Both chat and the legacy comparison screen use this exact loader.
 */
export async function loadLatestQuoteRiskLevels(
  quoteIds: readonly string[],
  client: typeof prisma = prisma,
): Promise<Map<string, string>> {
  if (!quoteIds.length) return new Map();
  const rows = await client.$queryRaw<
    Array<CommerceRiskAssessment & { entityId: string }>
  >`SELECT DISTINCT ON ("entityId")
      "entityId", "riskLevel"::text AS "riskLevel", "assessedBy"::text AS "assessedBy", "reasons"
    FROM "risk_assessments"
    WHERE "entityType" = 'quote'
      AND "entityId" IN (${Prisma.join([...quoteIds])})
    ORDER BY "entityId", "createdAt" DESC, "id" DESC`;
  const latestByQuoteId = new Map<string, string>();
  for (const row of rows) {
    if (!latestByQuoteId.has(row.entityId)) {
      latestByQuoteId.set(
        row.entityId,
        reviewedCommerceRiskLevel(row) ?? 'UNKNOWN',
      );
    }
  }
  return latestByQuoteId;
}

export async function loadLatestSupplierRiskLevels(
  supplierIds: readonly string[],
  client: typeof prisma = prisma,
): Promise<Map<string, string>> {
  if (!supplierIds.length) return new Map();
  const rows = await client.$queryRaw<
    Array<CommerceRiskAssessment & { entityId: string }>
  >`SELECT DISTINCT ON ("entityId")
      "entityId", "riskLevel"::text AS "riskLevel", "assessedBy"::text AS "assessedBy", "reasons"
    FROM "risk_assessments"
    WHERE "entityType" = 'supplier'
      AND "entityId" IN (${Prisma.join([...new Set(supplierIds)])})
    ORDER BY "entityId", "createdAt" DESC, "id" DESC`;
  return new Map(
    rows.map((row) => [
      row.entityId,
      reviewedCommerceRiskLevel(row) ?? 'UNKNOWN',
    ]),
  );
}

/** One customer-visibility boundary for every surface that renders offers. */
export function filterCustomerVisibleQuotes<
  T extends CustomerVisibleQuoteCandidate,
>(input: {
  quotes: readonly T[];
  item: CustomerQuoteEligibilityFacts['item'];
  part: Parameters<typeof isPartCommerceRestricted>[0];
  rfqStatus: string;
  latestRiskByQuoteId: ReadonlyMap<string, string>;
  latestSupplierRiskById?: ReadonlyMap<string, string>;
  now?: Date;
}): T[] {
  const now = input.now ?? new Date();
  const partRestricted = isPartCommerceRestricted(input.part);
  return input.quotes.filter((quote) =>
    isCustomerQuoteEligible(
      {
        quote: {
          partId: quote.partId,
          fitmentConfidence: quote.fitmentConfidence,
          status: quote.status,
          expiresAt: quote.expiresAt,
          riskLevel: quote.riskLevel,
          finalPrice: Number(quote.finalPrice),
        },
        item: input.item,
        rfqStatus: input.rfqStatus,
        supplierStatus: quote.supplier?.status ?? null,
        latestRiskLevel: input.latestRiskByQuoteId.get(quote.id) ?? null,
        latestSupplierRiskLevel: quote.supplier?.id
          ? (input.latestSupplierRiskById?.get(quote.supplier.id) ?? null)
          : null,
        partRestricted,
      },
      now,
    ),
  );
}
