export interface CommerceRiskAssessment {
  riskLevel: string;
  assessedBy?: string;
  reasons?: unknown;
}

export type ReviewedCommerceRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';

/** A block is always preserved; clearance requires attributable manual review. */
export function reviewedCommerceRiskLevel(
  assessment: CommerceRiskAssessment | null | undefined,
): ReviewedCommerceRiskLevel | null {
  if (!assessment) return null;
  if (assessment.riskLevel === 'HIGH' || assessment.riskLevel === 'BLOCKED')
    return assessment.riskLevel;
  const reasons = assessment.reasons;
  if (
    !['LOW', 'MEDIUM'].includes(assessment.riskLevel) ||
    assessment.assessedBy !== 'ADMIN' ||
    !reasons ||
    typeof reasons !== 'object' ||
    Array.isArray(reasons)
  )
    return null;
  const review = reasons as Record<string, unknown>;
  return review.policy === 'manual-review-v1' &&
    ['SUPPLIER_APPROVAL', 'SUPPLIER_REVIEW', 'QUOTE_REVIEW'].includes(
      String(review.reasonCode),
    ) &&
    typeof review.reviewedBy === 'string' &&
    review.reviewedBy.trim()
    ? assessment.riskLevel === 'LOW'
      ? 'LOW'
      : 'MEDIUM'
    : null;
}
