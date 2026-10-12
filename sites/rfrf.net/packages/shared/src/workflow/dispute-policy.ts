export const SUPPLIER_REJECTION_DISPUTE_PREFIX = 'SUPPLIER_REJECTED:';

/** A supplier rejection is an operations incident, never a customer claim to deny. */
export function isSupplierRejectionDisputeReason(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.startsWith(SUPPLIER_REJECTION_DISPUTE_PREFIX)
  );
}
