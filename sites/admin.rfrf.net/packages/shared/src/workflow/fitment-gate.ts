export interface FitmentGateInput {
  partId?: string | null;
  fitmentConfidence?: number | null;
  humanReviewRequired: boolean;
}

export type FitmentGateReason =
  | 'catalog_part_required'
  | 'fitment_confidence_required'
  | 'human_review_required';

export interface FitmentGateResult {
  ready: boolean;
  reasons: FitmentGateReason[];
}

/**
 * Hard workflow gate used before sourcing, activating, exposing, or selecting
 * quotes. Low confidence is allowed only after an operator explicitly clears
 * humanReviewRequired and leaves an audit trail.
 */
export function evaluateFitmentGate(
  input: FitmentGateInput,
): FitmentGateResult {
  const reasons: FitmentGateReason[] = [];
  if (!input.partId) reasons.push('catalog_part_required');
  if (
    input.fitmentConfidence == null ||
    !Number.isFinite(input.fitmentConfidence) ||
    input.fitmentConfidence < 0 ||
    input.fitmentConfidence > 1
  ) {
    reasons.push('fitment_confidence_required');
  }
  if (input.humanReviewRequired) reasons.push('human_review_required');
  return { ready: reasons.length === 0, reasons };
}
