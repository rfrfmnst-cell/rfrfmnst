import { isRankableQuote, type FitmentRecord } from './quote-policy';

export type CustomerQuoteEligibilityBlockReason =
  | 'RFQ_CANCELLED'
  | 'RFQ_ALREADY_CONVERTED'
  | 'QUOTE_NOT_RANKABLE'
  | 'SUPPLIER_NOT_APPROVED'
  | 'RISK_BLOCKED'
  | 'INVALID_PRICE'
  | 'PART_RESTRICTED';

export interface CustomerQuoteEligibilityFacts {
  quote: {
    partId: string | null;
    fitmentConfidence: number | null;
    status: string;
    expiresAt: Date | null;
    riskLevel: string;
    finalPrice: number;
  };
  item: FitmentRecord;
  rfqStatus: string;
  supplierStatus: string | null;
  latestRiskLevel: string | null;
  latestSupplierRiskLevel?: string | null;
  partRestricted: boolean;
}

export function isBlockingCommerceRisk(
  level: string | null | undefined,
): boolean {
  // Absence of a recorded review is not a positive clearance.
  return level !== 'LOW' && level !== 'MEDIUM';
}

/**
 * The single customer-facing commerce boundary used by approval, checkout,
 * comparison surfaces, and outbound offer notifications.
 */
export function customerQuoteEligibilityBlockReason(
  facts: CustomerQuoteEligibilityFacts,
  now = new Date(),
  options: { allowConvertedRfq?: boolean } = {},
): CustomerQuoteEligibilityBlockReason | null {
  if (facts.rfqStatus === 'CANCELLED') return 'RFQ_CANCELLED';
  if (facts.rfqStatus === 'CONVERTED_TO_ORDER' && !options.allowConvertedRfq) {
    return 'RFQ_ALREADY_CONVERTED';
  }
  if (facts.partRestricted) return 'PART_RESTRICTED';
  if (!isRankableQuote(facts.quote, facts.item, now)) {
    return 'QUOTE_NOT_RANKABLE';
  }
  if (facts.supplierStatus !== 'APPROVED') {
    return 'SUPPLIER_NOT_APPROVED';
  }
  if (
    isBlockingCommerceRisk(facts.quote.riskLevel) ||
    isBlockingCommerceRisk(facts.latestRiskLevel) ||
    isBlockingCommerceRisk(facts.latestSupplierRiskLevel)
  ) {
    return 'RISK_BLOCKED';
  }
  if (!Number.isFinite(facts.quote.finalPrice) || facts.quote.finalPrice <= 0) {
    return 'INVALID_PRICE';
  }
  return null;
}

export function isCustomerQuoteEligible(
  facts: CustomerQuoteEligibilityFacts,
  now = new Date(),
  options: { allowConvertedRfq?: boolean } = {},
): boolean {
  return customerQuoteEligibilityBlockReason(facts, now, options) === null;
}
