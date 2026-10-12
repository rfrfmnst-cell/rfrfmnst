import { isOrderPayable } from './payment-state';
export { orderPaymentIntakeLockKey } from './payment-intake-lock';

export const CHECKOUT_OUTCOME_UNKNOWN = 'CHECKOUT_OUTCOME_UNKNOWN';
export const CHECKOUT_OUTCOME_REJECTED = 'CHECKOUT_OUTCOME_REJECTED';
export const STALE_INTAKE_CONFIRMED_ABSENT = 'STALE_INTAKE_CONFIRMED_ABSENT';

export const ACTIVE_PAYMENT_INTAKE_STATUSES = [
  'PENDING',
  'AUTHORIZED',
  'CAPTURED',
  'HELD',
  'RELEASED',
] as const;

export function hasPaymentCaptureConflict(input: {
  orderStatus: string;
  currentPaymentId: string;
  activeOtherPaymentId: string | null;
  existingHold: { paymentId: string | null } | null;
}): boolean {
  return Boolean(
    !isOrderPayable(input.orderStatus) ||
    input.activeOtherPaymentId ||
    (input.existingHold &&
      input.existingHold.paymentId !== input.currentPaymentId),
  );
}
