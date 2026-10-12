export const VERIFIED_FITMENT_THRESHOLD = 0.85;

export interface FitmentRecord {
  partId: string | null;
  fitmentConfidence: number | null;
  humanReviewRequired: boolean;
}

export function isVerifiedFitment(
  record: FitmentRecord,
): record is FitmentRecord & {
  partId: string;
  fitmentConfidence: number;
  humanReviewRequired: false;
} {
  return (
    typeof record.partId === 'string' &&
    record.partId.length > 0 &&
    record.fitmentConfidence != null &&
    record.fitmentConfidence >= VERIFIED_FITMENT_THRESHOLD &&
    !record.humanReviewRequired
  );
}

export function matchesVerifiedPart(
  candidate: Pick<FitmentRecord, 'partId' | 'fitmentConfidence'>,
  item: FitmentRecord,
): boolean {
  return (
    isVerifiedFitment(item) &&
    candidate.partId === item.partId &&
    candidate.fitmentConfidence != null &&
    candidate.fitmentConfidence >= VERIFIED_FITMENT_THRESHOLD
  );
}

export function boundedFitmentConfidence(
  submitted: number,
  verified: number,
): number {
  if (!Number.isFinite(submitted) || submitted <= 0) return verified;
  return Math.min(verified, Math.min(1, Math.max(0, submitted)));
}

export type RankableQuoteStatus =
  | 'ACTIVE'
  | 'APPROVED'
  | 'SELECTED';

export interface RankableQuoteRecord
  extends Pick<FitmentRecord, 'partId' | 'fitmentConfidence'> {
  status: string;
  expiresAt: Date | null;
}

export function isRankableQuote(
  quote: RankableQuoteRecord,
  item: FitmentRecord,
  now: Date,
): boolean {
  return (
    matchesVerifiedPart(quote, item) &&
    (['ACTIVE', 'APPROVED', 'SELECTED'] as string[]).includes(quote.status) &&
    (quote.expiresAt == null || quote.expiresAt > now)
  );
}

export type SupplierQuoteView =
  | 'ALL'
  | 'OPEN'
  | 'DRAFT'
  | 'ACTIVE'
  | 'APPROVED'
  | 'SELECTED';

export interface SupplierQuoteVisibilityFacts {
  rfqOpen: boolean;
  fitmentReady: boolean;
  hasSupplierQuote: boolean;
  quoteStatus: Exclude<SupplierQuoteView, 'ALL' | 'OPEN'> | null;
}

/**
 * سياسة العرض المكافئة لاستعلام بوابة المورد:
 * الفرص المفتوحة تتطلب RFQ مفتوحًا وتوافقًا؛ السجل يعتمد على العرض نفسه حتى بعد
 * انتقال RFQ إلى QUOTES_READY أو الطلب.
 */
export function isVisibleInSupplierQuoteView(
  view: SupplierQuoteView,
  facts: SupplierQuoteVisibilityFacts,
): boolean {
  const openOpportunity =
    facts.rfqOpen && facts.fitmentReady && !facts.hasSupplierQuote;

  if (view === 'OPEN') return openOpportunity;
  if (view === 'ALL') return openOpportunity || facts.hasSupplierQuote;
  return facts.hasSupplierQuote && facts.quoteStatus === view;
}
