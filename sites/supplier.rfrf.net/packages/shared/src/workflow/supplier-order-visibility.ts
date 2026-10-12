/**
 * Orders become supplier-visible only after the captured-payment workflow has
 * secured escrow and released the order to supplier confirmation. Transient
 * payment states and pre-payment cancellations stay customer/operations-only.
 */
export const SUPPLIER_VISIBLE_ORDER_STATUSES = [
  'AWAITING_SUPPLIER_CONFIRMATION',
  'SUPPLIER_ACCEPTED',
  'FITMENT_VERIFIED',
  'READY_TO_SHIP',
  'SHIPPED',
  'IN_TRANSIT',
  'CUSTOMS_REVIEW',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COMPLAINT_WINDOW',
  'CLOSED',
  'PAYOUT_RELEASED',
  'REFUNDED',
  'DISPUTED',
] as const;

export type SupplierVisibleOrderStatus =
  (typeof SUPPLIER_VISIBLE_ORDER_STATUSES)[number];

const SUPPLIER_VISIBLE_ORDER_STATUS_SET = new Set<string>(
  SUPPLIER_VISIBLE_ORDER_STATUSES,
);

export function isSupplierOrderVisible(status: unknown): boolean {
  return (
    typeof status === 'string' && SUPPLIER_VISIBLE_ORDER_STATUS_SET.has(status)
  );
}
