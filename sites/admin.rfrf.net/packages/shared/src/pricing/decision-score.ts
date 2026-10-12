/**
 * Decision score engine — pure, no I/O.
 * Source of truth: docs/BUSINESS_RULES.md "Decision score formula (NORMALIZED)".
 *
 * Every sub-score is normalized to [0,1] before weighting. Positive weights sum
 * to 0.88 and penalties to 0.12, so the maximum achievable decision_score is 0.88
 * (NOT 1.0). Any threshold/tier must be calibrated against this ceiling.
 */

export const POSITIVE_WEIGHTS = {
  fitment: 0.3,
  vendor: 0.2,
  price: 0.18,
  delivery: 0.12,
  warranty: 0.08,
} as const;

export const PENALTY_WEIGHTS = {
  counterfeit: 0.05,
  compliance: 0.04,
  returnHistory: 0.03,
} as const;

/** Documented ceiling — exported so thresholds reference it, never a magic 1.0. */
export const MAX_DECISION_SCORE =
  POSITIVE_WEIGHTS.fitment +
  POSITIVE_WEIGHTS.vendor +
  POSITIVE_WEIGHTS.price +
  POSITIVE_WEIGHTS.delivery +
  POSITIVE_WEIGHTS.warranty; // = 0.88

export interface QuoteMetrics {
  quoteId: string;
  /** 0..1 */
  fitmentConfidence?: number;
  /** 0..100 */
  supplierScore?: number;
  /** currency-agnostic; compared within the set */
  price?: number;
  deliveryDays?: number;
  warrantyMonths?: number;
  /** 0..1 (0 = none, 1 = certain) */
  counterfeitRisk?: number;
  /** 0..1 */
  complianceRisk?: number;
  /** 0..1 (returns / orders) */
  supplierReturnRate?: number;
}

export interface SubScoreVector {
  fitment: number;
  vendor: number;
  price: number;
  delivery: number;
  warranty: number;
  counterfeitPenalty: number;
  compliancePenalty: number;
  returnHistoryPenalty: number;
}

export interface ScoredQuote {
  quoteId: string;
  decisionScore: number;
  subScores: SubScoreVector;
  humanReviewRequired: boolean;
  missingFields: string[];
}

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, n));

/**
 * Score one quote against its candidate set. `minPriceInSet` is the cheapest
 * price across the set (for price_score = min/this). Missing required sub-scores
 * are set to 0 AND flag human_review_required (BUSINESS_RULES).
 */
export function scoreQuote(
  q: QuoteMetrics,
  minPriceInSet: number,
): ScoredQuote {
  const missingFields: string[] = [];

  const fitment =
    q.fitmentConfidence ?? (missingFields.push('fitmentConfidence'), 0);
  const vendor =
    q.supplierScore != null
      ? clamp(q.supplierScore / 100, 0, 1)
      : (missingFields.push('supplierScore'), 0);
  const price =
    q.price != null && q.price > 0
      ? clamp(minPriceInSet / q.price, 0, 1)
      : (missingFields.push('price'), 0);
  const delivery =
    q.deliveryDays != null
      ? clamp(1 - q.deliveryDays / 30, 0, 1)
      : (missingFields.push('deliveryDays'), 0);
  const warranty =
    q.warrantyMonths != null
      ? clamp(q.warrantyMonths / 24, 0, 1)
      : (missingFields.push('warrantyMonths'), 0);

  // Penalties default to 0 when unknown (absence of known risk is not a demerit).
  const counterfeitPenalty = clamp(q.counterfeitRisk ?? 0, 0, 1);
  const compliancePenalty = clamp(q.complianceRisk ?? 0, 0, 1);
  const returnHistoryPenalty = clamp(q.supplierReturnRate ?? 0, 0, 1);

  const raw =
    fitment * POSITIVE_WEIGHTS.fitment +
    vendor * POSITIVE_WEIGHTS.vendor +
    price * POSITIVE_WEIGHTS.price +
    delivery * POSITIVE_WEIGHTS.delivery +
    warranty * POSITIVE_WEIGHTS.warranty -
    counterfeitPenalty * PENALTY_WEIGHTS.counterfeit -
    compliancePenalty * PENALTY_WEIGHTS.compliance -
    returnHistoryPenalty * PENALTY_WEIGHTS.returnHistory;

  const decisionScore = clamp(raw, 0, 1);

  // Rule 5 also forces review below 0.85 fitment.
  const humanReviewRequired =
    missingFields.length > 0 || (q.fitmentConfidence ?? 0) < 0.85;

  return {
    quoteId: q.quoteId,
    decisionScore,
    subScores: {
      fitment,
      vendor,
      price,
      delivery,
      warranty,
      counterfeitPenalty,
      compliancePenalty,
      returnHistoryPenalty,
    },
    humanReviewRequired,
    missingFields,
  };
}

export type RecommendationLabel =
  'BEST_OVERALL' | 'CHEAPEST' | 'FASTEST' | 'HIGHEST_WARRANTY' | 'LOWEST_RISK';

export interface RankedSet {
  scored: ScoredQuote[];
  labels: Partial<Record<RecommendationLabel, string>>; // label -> quoteId
  explanationSeed: {
    bestOverallQuoteId?: string;
    cheapestQuoteId?: string;
    fastestQuoteId?: string;
  };
}

/**
 * Score and label a full candidate set for one RFQ item.
 * BEST_OVERALL = highest decision score; the rest are single-metric extremes.
 */
export function rankQuoteSet(quotes: QuoteMetrics[]): RankedSet {
  if (quotes.length === 0) {
    return { scored: [], labels: {}, explanationSeed: {} };
  }

  const priced = quotes.filter((q) => q.price != null && q.price > 0);
  const minPrice = priced.length
    ? Math.min(...priced.map((q) => q.price as number))
    : 0;

  const scored = quotes.map((q) => scoreQuote(q, minPrice));

  const bestOverall = scored.reduce((a, b) =>
    b.decisionScore > a.decisionScore ? b : a,
  );

  const pick = (
    better: (a: QuoteMetrics, b: QuoteMetrics) => boolean,
    guard: (q: QuoteMetrics) => boolean,
  ): string | undefined => {
    const pool = quotes.filter(guard);
    if (!pool.length) return undefined;
    return pool.reduce((a, b) => (better(b, a) ? b : a)).quoteId;
  };

  const cheapest = pick(
    (b, a) => (b.price as number) < (a.price as number),
    (q) => q.price != null && q.price > 0,
  );
  const fastest = pick(
    (b, a) => (b.deliveryDays as number) < (a.deliveryDays as number),
    (q) => q.deliveryDays != null,
  );
  const highestWarranty = pick(
    (b, a) => (b.warrantyMonths as number) > (a.warrantyMonths as number),
    (q) => q.warrantyMonths != null,
  );
  const lowestRisk = pick(
    (b, a) =>
      (b.counterfeitRisk ?? 0) + (b.complianceRisk ?? 0) <
      (a.counterfeitRisk ?? 0) + (a.complianceRisk ?? 0),
    () => true,
  );

  const labels: Partial<Record<RecommendationLabel, string>> = {
    BEST_OVERALL: bestOverall.quoteId,
  };
  if (cheapest) labels.CHEAPEST = cheapest;
  if (fastest) labels.FASTEST = fastest;
  if (highestWarranty) labels.HIGHEST_WARRANTY = highestWarranty;
  if (lowestRisk) labels.LOWEST_RISK = lowestRisk;

  return {
    scored,
    labels,
    explanationSeed: {
      bestOverallQuoteId: bestOverall.quoteId,
      cheapestQuoteId: cheapest,
      fastestQuoteId: fastest,
    },
  };
}
