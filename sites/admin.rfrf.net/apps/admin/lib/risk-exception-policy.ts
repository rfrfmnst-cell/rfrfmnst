import { QuoteStatus, RFQStatus, RiskLevel } from '@rafraf/db';

export const LOCKED_RFQ_STATUSES: RFQStatus[] = [
  RFQStatus.CUSTOMER_SELECTED,
  RFQStatus.CONVERTED_TO_ORDER,
  RFQStatus.CANCELLED,
];

export const MUTABLE_RISKY_QUOTE_STATUSES: QuoteStatus[] = [
  QuoteStatus.ACTIVE,
  QuoteStatus.APPROVED,
];

export const ELIGIBLE_ALTERNATIVE_STATUSES: QuoteStatus[] = [
  QuoteStatus.ACTIVE,
  QuoteStatus.APPROVED,
];

export const REVIEWABLE_RISK_LEVELS: RiskLevel[] = [
  RiskLevel.HIGH,
  RiskLevel.BLOCKED,
];

export const DECISION_ACTIONS = [
  'risk.exception.local_override',
  'risk.exception.repricing_requested',
  'risk.exception.rollback',
];

export const ROLLBACK_WINDOW_MS = 15 * 60 * 1000;

export class DecisionConflict extends Error {}

export function isQuoteStatus(value: unknown): value is QuoteStatus {
  return (
    typeof value === 'string' &&
    (Object.values(QuoteStatus) as string[]).includes(value)
  );
}

export function isRfqStatus(value: unknown): value is RFQStatus {
  return (
    typeof value === 'string' &&
    (Object.values(RFQStatus) as string[]).includes(value)
  );
}
