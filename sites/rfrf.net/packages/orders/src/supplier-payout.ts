import {
  SUPPLIER_PAYOUT_INVALID_REFERENCE,
  supplierPayoutRecordingDecision,
} from '@rafraf/shared/payments/supplier-payout-policy';

export type MarkSupplierPayoutOutcome =
  | 'PAID'
  | 'REPLAYED'
  | 'NOT_FOUND'
  | 'NOT_ACTIONABLE'
  | 'REFERENCE_CONFLICT'
  | 'WORKFLOW_NOT_READY';

/**
 * Supplier payouts are intentionally non-executable. A typed bank reference
 * cannot prove transfer or settlement, and a single operator cannot satisfy
 * maker-checker. The PAID transition must be implemented anew with those
 * controls; keeping the old database write behind a flag would be unsafe.
 */
export async function markSupplierPayoutPaid(input: {
  payoutId: string;
  reference: string;
  actorId: string;
  now?: Date;
}): Promise<MarkSupplierPayoutOutcome> {
  const decision = supplierPayoutRecordingDecision(input.reference);
  return decision.reason === SUPPLIER_PAYOUT_INVALID_REFERENCE
    ? 'NOT_ACTIONABLE'
    : 'WORKFLOW_NOT_READY';
}
