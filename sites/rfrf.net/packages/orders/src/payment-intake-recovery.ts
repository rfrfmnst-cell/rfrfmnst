import { ActorType, PaymentStatus, prisma } from '@rafraf/db';
import {
  ACTIVE_PAYMENT_INTAKE_STATUSES,
  STALE_INTAKE_CONFIRMED_ABSENT,
  orderPaymentIntakeLockKey,
} from '@rafraf/shared/payments/payment-intake';

export type RecoverFailedPaymentIntakeOutcome =
  | 'REOPENED'
  | 'REFERENCE_BOUND_WHILE_RETRY_ACTIVE'
  | 'REPLAYED'
  | 'NOT_ACTIONABLE';

/**
 * Applies a provider-confirmed reference to an operator-resolved intake.
 *
 * Checkout and this recovery path share the same order-scoped advisory lock.
 * If the customer already started another attempt, the old row remains FAILED
 * so the active-attempt uniqueness invariant cannot be violated. Its verified
 * reference is still retained, allowing a later CAPTURED callback to enter the
 * duplicate-capture refund workflow instead of losing provider evidence.
 */
export async function recoverFailedPaymentIntakeReference(
  input: {
    paymentId: string;
    orderId: string;
    verifiedReference: string;
  },
  client: typeof prisma = prisma,
): Promise<RecoverFailedPaymentIntakeOutcome> {
  const verifiedReference = input.verifiedReference.trim();
  if (!verifiedReference || verifiedReference.length > 255) {
    return 'NOT_ACTIONABLE';
  }

  return client.$transaction(async (tx) => {
    const intakeLock = orderPaymentIntakeLockKey(input.orderId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${intakeLock}))`;

    const payment = await tx.payment.findUnique({
      where: { id: input.paymentId },
      select: {
        id: true,
        orderId: true,
        status: true,
        externalRef: true,
        failureCode: true,
      },
    });
    if (!payment || payment.orderId !== input.orderId) return 'NOT_ACTIONABLE';
    if (
      payment.status === PaymentStatus.FAILED &&
      payment.failureCode === STALE_INTAKE_CONFIRMED_ABSENT &&
      payment.externalRef === verifiedReference
    ) {
      return 'REPLAYED';
    }
    if (
      payment.status !== PaymentStatus.FAILED ||
      payment.failureCode !== STALE_INTAKE_CONFIRMED_ABSENT ||
      payment.externalRef !== null
    ) {
      return 'NOT_ACTIONABLE';
    }

    const activeOtherPayment = await tx.payment.findFirst({
      where: {
        orderId: input.orderId,
        id: { not: payment.id },
        status: { in: [...ACTIVE_PAYMENT_INTAKE_STATUSES] },
      },
      select: { id: true },
    });
    const retryIsActive = Boolean(activeOtherPayment);
    const updated = await tx.payment.updateMany({
      where: {
        id: payment.id,
        status: PaymentStatus.FAILED,
        failureCode: STALE_INTAKE_CONFIRMED_ABSENT,
        externalRef: null,
      },
      data: retryIsActive
        ? { externalRef: verifiedReference }
        : {
            status: PaymentStatus.PENDING,
            externalRef: verifiedReference,
            failureCode: null,
          },
    });
    if (updated.count !== 1) return 'NOT_ACTIONABLE';

    const outcome = retryIsActive
      ? 'REFERENCE_BOUND_WHILE_RETRY_ACTIVE'
      : 'REOPENED';
    await tx.auditLog.create({
      data: {
        actorType: ActorType.SYSTEM,
        action: retryIsActive
          ? 'payment.intake.reference_bound_while_retry_active'
          : 'payment.intake.reopened_from_provider',
        entityType: 'payment',
        entityId: payment.id,
        before: { status: PaymentStatus.FAILED },
        after: {
          status: retryIsActive ? PaymentStatus.FAILED : PaymentStatus.PENDING,
          providerReferenceBound: true,
          activeRetryPreserved: retryIsActive,
        },
      },
    });
    return outcome;
  });
}
