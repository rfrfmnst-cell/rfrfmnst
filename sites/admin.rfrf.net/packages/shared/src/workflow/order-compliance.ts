import {
  complianceClearsShipping,
  type ComplianceReviewState,
} from './compliance-state';

export const COMPLIANCE_REVIEW_ORDER_STATUSES: readonly string[] = [
  'CREATED',
  'AWAITING_CUSTOMER_CONFIRMATION',
  'AWAITING_PAYMENT',
  'PAID',
  'ESCROW_HELD',
  'AWAITING_SUPPLIER_CONFIRMATION',
  'SUPPLIER_ACCEPTED',
  'FITMENT_VERIFIED',
  'READY_TO_SHIP',
];

export const COMPLIANCE_PART_SELECT = {
  id: true,
  saberRequired: true,
  sasoScheme: true,
} as const;

/** The newest order-specific review governs; product-wide certificates alone do not. */
export const ORDER_COMPLIANCE_SELECT = {
  quote: {
    select: {
      part: { select: COMPLIANCE_PART_SELECT },
      rfqItem: { select: { part: { select: COMPLIANCE_PART_SELECT } } },
    },
  },
  complianceCases: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] as {
      createdAt?: 'desc';
      id?: 'desc';
    }[],
    take: 1,
  },
} as const;

export interface CompliancePart {
  id: string;
  saberRequired: boolean;
  sasoScheme: string | null;
}

export interface OrderComplianceReview {
  id: string;
  partId: string | null;
  saberRequired: boolean;
  sasoScheme: string | null;
  reviewStatus: string;
  pcocStatus: string;
  scocStatus: string;
  assignedTo: string | null;
  notes: string | null;
}

export interface OrderComplianceFacts {
  quote: {
    part: CompliancePart | null;
    rfqItem: { part: CompliancePart | null };
  };
  complianceCases: readonly OrderComplianceReview[];
}

export function orderComplianceLockKey(orderId: string): string {
  return `order-compliance:${orderId}`;
}

export function reviewMatchesPart(
  review: OrderComplianceReview | null | undefined,
  part: CompliancePart,
): boolean {
  return (
    review?.partId === part.id &&
    review.saberRequired === part.saberRequired &&
    review.sasoScheme === part.sasoScheme
  );
}

export function orderComplianceStatus(facts: OrderComplianceFacts) {
  const quoted = facts.quote.part;
  const requested = facts.quote.rfqItem.part;
  const part = quoted ?? requested;
  const review = facts.complianceCases[0] ?? null;
  if (!part || (quoted && requested && quoted.id !== requested.id)) {
    return {
      cleared: false,
      required: true,
      reason: 'PART_UNCLASSIFIED' as const,
      part: null,
      review,
    };
  }
  const required =
    part.saberRequired ||
    part.sasoScheme !== null ||
    review?.saberRequired === true ||
    review?.sasoScheme != null;
  // The schema defaults also describe never-classified legacy parts. Even an
  // unregulated classification needs an explicit order-specific review.
  if (
    !review ||
    !reviewMatchesPart(review, part) ||
    !review.assignedTo ||
    !complianceClearsShipping(review.reviewStatus as ComplianceReviewState) ||
    (required && review.reviewStatus !== 'APPROVED')
  ) {
    return {
      cleared: false,
      required,
      reason: 'REVIEW_REQUIRED' as const,
      part,
      review,
    };
  }
  const certificatesClear = required
    ? review.pcocStatus === 'APPROVED' &&
      review.scocStatus === 'APPROVED' &&
      Boolean(review.notes?.trim())
    : ['NOT_REQUIRED', 'APPROVED'].includes(review.pcocStatus) &&
      ['NOT_REQUIRED', 'APPROVED'].includes(review.scocStatus);
  return {
    cleared: certificatesClear,
    required,
    reason: certificatesClear ? null : ('CERTIFICATES_REQUIRED' as const),
    part,
    review,
  };
}
