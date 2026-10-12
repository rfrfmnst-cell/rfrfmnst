import {
  ActorType,
  EscrowEntryType,
  OrderStatus,
  PaymentStatus,
  prisma,
} from '@rafraf/db';
import {
  STALE_INTAKE_CONFIRMED_ABSENT,
  orderPaymentIntakeLockKey,
} from '@rafraf/shared/payments/payment-intake';

export const STALE_PAYMENT_INTAKE_MINUTES = 30;
const REVIEW_REFERENCE = /^[A-Z0-9][A-Z0-9._:/-]{9,119}$/u;

export type ResolveStalePaymentIntakeOutcome =
  | 'RESOLVED_FAILED'
  | 'REPLAYED'
  | 'NOT_STALE'
  | 'INVALID_INPUT'
  | 'NOT_ACTIONABLE'
  | 'NOT_FOUND';

/**
 * Unlocks an initiate request only after an operator confirms in EdfaPay that
 * no transaction exists. A later signed callback can still reopen this exact
 * provider attempt because `providerOrderCode` remains immutable.
 */
export async function resolveStalePaymentIntake(
  input: {
    paymentId: string;
    confirmOrderCode: string;
    reviewReference: string;
    actorId: string;
    now?: Date;
  },
  client: typeof prisma = prisma,
): Promise<ResolveStalePaymentIntakeOutcome> {
  const orderCode = input.confirmOrderCode.trim().toUpperCase();
  const reviewReference = input.reviewReference.trim().toUpperCase();
  if (!orderCode || !REVIEW_REFERENCE.test(reviewReference)) {
    return 'INVALID_INPUT';
  }
  const now = input.now ?? new Date();
  const staleBefore = new Date(
    now.getTime() - STALE_PAYMENT_INTAKE_MINUTES * 60_000,
  );

  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment-intake-resolution:${input.paymentId}`}))`;
    const scope = await tx.payment.findUnique({
      where: { id: input.paymentId },
      select: { orderId: true },
    });
    if (!scope) return 'NOT_FOUND';
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order-financial-resolution:${scope.orderId}`}))`;
    const intakeLock = orderPaymentIntakeLockKey(scope.orderId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${intakeLock}))`;

    const [payment, hold] = await Promise.all([
      tx.payment.findUnique({
        where: { id: input.paymentId },
        select: {
          id: true,
          status: true,
          provider: true,
          externalRef: true,
          providerOrderCode: true,
          failureCode: true,
          updatedAt: true,
          order: { select: { code: true, status: true } },
        },
      }),
      tx.escrowLedgerEntry.findFirst({
        where: {
          orderId: scope.orderId,
          entryType: EscrowEntryType.HOLD,
        },
        select: { id: true },
      }),
    ]);
    if (!payment) return 'NOT_FOUND';
    if (
      payment.status === PaymentStatus.FAILED &&
      payment.failureCode === STALE_INTAKE_CONFIRMED_ABSENT
    ) {
      return 'REPLAYED';
    }
    if (payment.updatedAt > staleBefore) return 'NOT_STALE';
    if (
      payment.provider !== 'EDFAPAY' ||
      payment.status !== PaymentStatus.PENDING ||
      payment.externalRef !== null ||
      !payment.providerOrderCode ||
      payment.order.code !== orderCode ||
      payment.order.status !== OrderStatus.AWAITING_PAYMENT ||
      hold
    ) {
      return 'NOT_ACTIONABLE';
    }

    const changed = await tx.payment.updateMany({
      where: {
        id: payment.id,
        status: PaymentStatus.PENDING,
        externalRef: null,
        updatedAt: { lte: staleBefore },
      },
      data: {
        status: PaymentStatus.FAILED,
        failureCode: STALE_INTAKE_CONFIRMED_ABSENT,
      },
    });
    if (changed.count !== 1) return 'NOT_ACTIONABLE';
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorType: ActorType.ADMIN,
        action: 'payment.intake.confirmed_absent',
        entityType: 'payment',
        entityId: payment.id,
        before: { status: PaymentStatus.PENDING },
        after: {
          status: PaymentStatus.FAILED,
          providerOrderCode: payment.providerOrderCode,
          providerReviewReference: reviewReference,
        },
      },
    });
    return 'RESOLVED_FAILED';
  });
}
