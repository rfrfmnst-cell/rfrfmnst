import {
  reviewedCommerceRiskLevel,
  type CommerceRiskAssessment,
} from '@rafraf/shared/product-os/reviewed-commerce-risk';
import { Prisma, prisma } from '@rafraf/db';
import {
  isCustomerQuoteEligible,
  type CustomerQuoteEligibilityFacts,
} from '@rafraf/shared/product-os/customer-quote-eligibility';
import { isPartCommerceRestricted } from '@rafraf/shared/product-os/part-restriction';

interface CustomerOfferCandidate {
  id: string;
  partId: string | null;
  fitmentConfidence: number | null;
  status: string;
  expiresAt: Date | null;
  riskLevel: string;
  finalPrice: unknown;
  supplier: { id: string; status: string } | null;
}

async function latestRiskLevels(
  entityType: 'quote' | 'supplier',
  entityIds: readonly string[],
  client: Pick<Prisma.TransactionClient, '$queryRaw'>,
): Promise<Map<string, string>> {
  if (!entityIds.length) return new Map();
  const rows = await client.$queryRaw<
    Array<CommerceRiskAssessment & { entityId: string }>
  >(Prisma.sql`SELECT DISTINCT ON ("entityId")
      "entityId", "riskLevel"::text AS "riskLevel", "assessedBy"::text AS "assessedBy", "reasons"
    FROM "risk_assessments"
    WHERE "entityType" = ${entityType}
      AND "entityId" IN (${Prisma.join([...new Set(entityIds)])})
    ORDER BY "entityId", "createdAt" DESC, "id" DESC`);
  return new Map(
    rows.map((row) => [
      row.entityId,
      reviewedCommerceRiskLevel(row) ?? 'UNKNOWN',
    ]),
  );
}

/** Bounded newest risk snapshots for the exact candidate/supplier set. */
export async function loadCustomerOfferRiskLevels(
  quotes: readonly CustomerOfferCandidate[],
  client: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma,
): Promise<{
  quoteRisks: ReadonlyMap<string, string>;
  supplierRisks: ReadonlyMap<string, string>;
}> {
  const [quoteRisks, supplierRisks] = await Promise.all([
    latestRiskLevels(
      'quote',
      quotes.map((quote) => quote.id),
      client,
    ),
    latestRiskLevels(
      'supplier',
      quotes.flatMap((quote) =>
        quote.supplier?.id ? [quote.supplier.id] : [],
      ),
      client,
    ),
  ]);
  return { quoteRisks, supplierRisks };
}

/** Same eligibility contract used by customer chat/comparison/approval. */
export function filterCustomerOfferCandidates<
  T extends CustomerOfferCandidate,
>(input: {
  quotes: readonly T[];
  item: CustomerQuoteEligibilityFacts['item'];
  part: Parameters<typeof isPartCommerceRestricted>[0];
  rfqStatus: string;
  quoteRisks: ReadonlyMap<string, string>;
  supplierRisks: ReadonlyMap<string, string>;
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
        latestRiskLevel: input.quoteRisks.get(quote.id) ?? null,
        latestSupplierRiskLevel: quote.supplier?.id
          ? (input.supplierRisks.get(quote.supplier.id) ?? null)
          : null,
        partRestricted,
      },
      now,
    ),
  );
}
