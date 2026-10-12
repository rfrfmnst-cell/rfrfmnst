import {
  ActorType,
  EscrowEntryType,
  OrderStatus,
  PayoutStatus,
  PaymentRefundStatus,
  PaymentStatus,
  prisma,
} from '@rafraf/db';
import type { RefundPaymentProvider } from '@rafraf/shared/payments/edfapay-refund-provider';
import { isPaymentProviderError } from '@rafraf/shared/payments/payment-provider';
import { canTransitionOrder } from '@rafraf/shared/workflow/order-state';
import {
  DUPLICATE_PARTIAL_REFUND_FAILURE,
  FINANCIAL_RECONCILIATION_FAILURE,
  PARTIAL_REFUND_FAILURE,
  isDuplicateCaptureFailure,
  updateOpenRefundOperation,
} from './provider-refund-reconciliation.ts';
import {
  reconcileDuplicateCaptureRefund,
  resolveDuplicateCaptureRefund,
} from './duplicate-capture-refund.ts';
import {
  preflightPurchaseRefund,
  protectRequestedRefund,
  reserveRefundPost,
} from './payment-refund-preflight.ts';
import { reconcileConfirmedRefund } from './payment-refund-reconcile.ts';

export {
  reconcileConfirmedRefund,
  type ReconcileConfirmedRefundOutcome,
} from './payment-refund-reconcile.ts';

export type RefundPaymentOutcome =
  | 'COMPLETED'
  | 'REPLAYED'
  | 'PROVIDER_PENDING'
  | 'FAILED_FINAL'
  | 'NOT_FOUND'
  | 'NOT_ACTIONABLE';

export async function refundPayment(
  input: {
    paymentId: string;
    actorId: string;
    actorType?: ActorType;
    confirmOrderCode: string;
    provider: RefundPaymentProvider;
  },
  client: typeof prisma = prisma,
): Promise<RefundPaymentOutcome> {
  const actorType = input.actorType ?? ActorType.ADMIN;
  const reserved = await client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment-refund:${input.paymentId}`}))`;
    const paymentScope = await tx.payment.findUnique({
      where: { id: input.paymentId },
      select: { orderId: true },
    });
    if (!paymentScope) return { outcome: 'NOT_FOUND' as const };

    // Refund and payout are mutually exclusive external money movements. Every
    // path that can move either side takes this order-scoped lock before it
    // reserves work, so a provider refund can never race a supplier release.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order-financial-resolution:${paymentScope.orderId}`}))`;
    const payment = await tx.payment.findUnique({
      where: { id: input.paymentId },
      include: {
        order: {
          select: { id: true, code: true, status: true, supplierId: true },
        },
        refunds: true,
        escrowEntries: {
          select: { entryType: true, amount: true, currency: true },
        },
      },
    });
    if (!payment) return { outcome: 'NOT_FOUND' as const };
    const existing = payment.refunds[0];
    if (existing?.status === PaymentRefundStatus.COMPLETED) {
      return { outcome: 'REPLAYED' as const };
    }
    if (existing && isDuplicateCaptureFailure(existing.failureCode)) {
      if (
        input.confirmOrderCode.trim() !== payment.order.code ||
        input.provider.name !== payment.provider ||
        !payment.externalRef
      ) {
        return { outcome: 'NOT_ACTIONABLE' as const };
      }
      if (existing.status === PaymentRefundStatus.FAILED_FINAL) {
        return { outcome: 'FAILED_FINAL' as const };
      }
      const callProvider = existing.status === PaymentRefundStatus.REQUESTED;
      const checkProvider =
        existing.status === PaymentRefundStatus.PROCESSING ||
        existing.status === PaymentRefundStatus.PROVIDER_PENDING;
      if (!callProvider && !checkProvider) {
        return { outcome: 'NOT_ACTIONABLE' as const };
      }
      return {
        outcome: callProvider
          ? ('PREFLIGHT_DUPLICATE_PROVIDER' as const)
          : ('CHECK_DUPLICATE_PROVIDER' as const),
        operationId: existing.id,
        payment,
      };
    }
    if (existing?.status === PaymentRefundStatus.FAILED_FINAL) {
      return { outcome: 'FAILED_FINAL' as const };
    }

    if (
      input.confirmOrderCode.trim() !== payment.order.code ||
      input.provider.name !== payment.provider ||
      !payment.externalRef
    ) {
      return { outcome: 'NOT_ACTIONABLE' as const };
    }
    if (
      existing?.status === PaymentRefundStatus.PROCESSING ||
      existing?.status === PaymentRefundStatus.PROVIDER_PENDING
    ) {
      return {
        outcome: 'CHECK_PROVIDER' as const,
        operationId: existing.id,
        payment,
      };
    }

    const holds = payment.escrowEntries.filter(
      (entry) => entry.entryType === EscrowEntryType.HOLD,
    );
    const hold = holds[0];
    const settled = payment.escrowEntries.some(
      (entry) =>
        entry.entryType === EscrowEntryType.RELEASE ||
        entry.entryType === EscrowEntryType.REFUND ||
        entry.entryType === EscrowEntryType.PAYOUT,
    );
    const supplierPayout = await tx.supplierPayout.findFirst({
      where: {
        orderId: payment.orderId,
        status: { not: PayoutStatus.CANCELLED },
      },
      select: { id: true },
    });
    if (
      (payment.status !== PaymentStatus.CAPTURED &&
        payment.status !== PaymentStatus.HELD) ||
      !canTransitionOrder(payment.order.status, OrderStatus.REFUNDED) ||
      !hold ||
      holds.length !== 1 ||
      !hold.amount.equals(payment.amount) ||
      hold.currency !== payment.currency ||
      settled ||
      Boolean(supplierPayout)
    ) {
      return { outcome: 'NOT_ACTIONABLE' as const };
    }

    const operation =
      existing ??
      (await tx.paymentRefund.create({
        data: {
          paymentId: payment.id,
          orderId: payment.orderId,
          amount: payment.amount,
          currency: payment.currency,
          requestedBy: input.actorId,
          status: PaymentRefundStatus.REQUESTED,
        },
      }));
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorType,
        action: 'payment.refund.requested',
        entityType: 'payment_refund',
        entityId: operation.id,
        after: { paymentId: payment.id, provider: payment.provider },
      },
    });
    return {
      outcome: 'PREFLIGHT_PROVIDER' as const,
      operationId: operation.id,
      payment,
    };
  });

  if (reserved.outcome === 'PREFLIGHT_DUPLICATE_PROVIDER') {
    const providerOrderCode =
      reserved.payment.providerOrderCode ?? reserved.payment.order.code;
    const preflight = await preflightPurchaseRefund({
      orderCode: providerOrderCode,
      purchaseExternalRef: reserved.payment.externalRef!,
      amount: reserved.payment.amount.toFixed(2),
      currency: reserved.payment.currency,
      provider: input.provider,
    });
    if (preflight === 'ALREADY_REFUNDED') {
      return reconcileDuplicateCaptureRefund(
        {
          paymentId: input.paymentId,
          actorId: input.actorId,
          actorType,
          provider: input.provider.name,
          externalRef: null,
        },
        client,
      );
    }
    if (preflight === 'PARTIAL_REFUND') {
      return protectRequestedRefund(
        reserved.operationId,
        DUPLICATE_PARTIAL_REFUND_FAILURE,
        client,
      );
    }
    if (preflight === 'PROVIDER_CONFLICT') {
      return protectRequestedRefund(
        reserved.operationId,
        FINANCIAL_RECONCILIATION_FAILURE,
        client,
      );
    }
    if (preflight === 'RETRY') return 'PROVIDER_PENDING';
    const postReservation = await reserveRefundPost(
      reserved.operationId,
      client,
    );
    if (postReservation !== 'RESERVED') return postReservation;
    return resolveDuplicateCaptureRefund(
      {
        action: 'CALL_PROVIDER',
        paymentId: input.paymentId,
        operationId: reserved.operationId,
        actorId: input.actorId,
        orderCode: providerOrderCode,
        purchaseExternalRef: reserved.payment.externalRef!,
        amount: reserved.payment.amount.toFixed(2),
        currency: reserved.payment.currency,
        provider: input.provider,
      },
      client,
    );
  }

  if (reserved.outcome === 'CHECK_DUPLICATE_PROVIDER') {
    const providerOrderCode =
      reserved.payment.providerOrderCode ?? reserved.payment.order.code;
    return resolveDuplicateCaptureRefund(
      {
        action: 'CHECK_PROVIDER',
        paymentId: input.paymentId,
        operationId: reserved.operationId,
        actorId: input.actorId,
        orderCode: providerOrderCode,
        purchaseExternalRef: reserved.payment.externalRef!,
        amount: reserved.payment.amount.toFixed(2),
        currency: reserved.payment.currency,
        provider: input.provider,
      },
      client,
    );
  }

  let providerAction: 'CALL_PROVIDER' | 'CHECK_PROVIDER';
  if (reserved.outcome === 'PREFLIGHT_PROVIDER') {
    const providerOrderCode =
      reserved.payment.providerOrderCode ?? reserved.payment.order.code;
    const preflight = await preflightPurchaseRefund({
      orderCode: providerOrderCode,
      purchaseExternalRef: reserved.payment.externalRef!,
      amount: reserved.payment.amount.toFixed(2),
      currency: reserved.payment.currency,
      provider: input.provider,
    });
    if (preflight === 'ALREADY_REFUNDED') {
      const reconciliation = await reconcileConfirmedRefund(
        {
          paymentId: input.paymentId,
          actorId: input.actorId,
          actorType,
          provider: input.provider.name,
          externalRef: reserved.payment.refunds[0]?.externalRef ?? null,
        },
        client,
      );
      if (reconciliation === 'COMPLETED' || reconciliation === 'REPLAYED') {
        return reconciliation;
      }
      return reconciliation === 'NOT_FOUND' ? 'NOT_FOUND' : 'NOT_ACTIONABLE';
    }
    if (preflight === 'PARTIAL_REFUND') {
      return protectRequestedRefund(
        reserved.operationId,
        PARTIAL_REFUND_FAILURE,
        client,
      );
    }
    if (preflight === 'PROVIDER_CONFLICT') {
      return protectRequestedRefund(
        reserved.operationId,
        FINANCIAL_RECONCILIATION_FAILURE,
        client,
      );
    }
    if (preflight === 'RETRY') return 'PROVIDER_PENDING';
    const postReservation = await reserveRefundPost(
      reserved.operationId,
      client,
    );
    if (postReservation !== 'RESERVED') return postReservation;
    providerAction = 'CALL_PROVIDER';
  } else if (reserved.outcome === 'CHECK_PROVIDER') {
    providerAction = 'CHECK_PROVIDER';
  } else {
    return reserved.outcome;
  }

  let result;
  const providerOrderCode =
    reserved.payment.providerOrderCode ?? reserved.payment.order.code;
  try {
    result =
      providerAction === 'CALL_PROVIDER'
        ? await input.provider.refund({
            orderCode: providerOrderCode,
            externalRef: reserved.payment.externalRef!,
            money: {
              amount: reserved.payment.amount.toFixed(2),
              currency: reserved.payment.currency,
            },
          })
        : await input.provider.status(
            providerOrderCode,
            reserved.payment.externalRef!,
            reserved.payment.amount.toFixed(2),
            reserved.payment.currency,
          );
  } catch (error) {
    const providerFailure = isPaymentProviderError(error);
    const concurrentOutcome = await updateOpenRefundOperation(
      {
        operationId: reserved.operationId,
        // A POST rejection can race a provider-side refund. No HTTP error,
        // including a typed 4xx, proves that external money did not move.
        status: PaymentRefundStatus.PROVIDER_PENDING,
        failureCode:
          providerFailure || error instanceof Error
            ? error.message.slice(0, 120)
            : 'UNKNOWN',
      },
      client,
    );
    if (concurrentOutcome) return concurrentOutcome;
    return 'PROVIDER_PENDING';
  }

  if (result.reconciliationIssue === PARTIAL_REFUND_FAILURE) {
    const refundExternalRef =
      reserved.payment.refunds[0]?.externalRef ??
      (providerAction === 'CALL_PROVIDER' ? result.externalRef : null);
    const concurrentOutcome = await updateOpenRefundOperation(
      {
        operationId: reserved.operationId,
        status: PaymentRefundStatus.PROVIDER_PENDING,
        externalRef: refundExternalRef,
        failureCode: PARTIAL_REFUND_FAILURE,
      },
      client,
    );
    return concurrentOutcome ?? 'PROVIDER_PENDING';
  }

  if (result.outcome !== 'REFUNDED') {
    const refundExternalRef =
      reserved.payment.refunds[0]?.externalRef ??
      (providerAction === 'CALL_PROVIDER' ? result.externalRef : null);
    const providerConflict =
      providerAction === 'CHECK_PROVIDER' &&
      ['DECLINED', 'CANCELLED'].includes(result.outcome);
    const concurrentOutcome = await updateOpenRefundOperation(
      {
        operationId: reserved.operationId,
        status: PaymentRefundStatus.PROVIDER_PENDING,
        externalRef: refundExternalRef,
        failureCode: providerConflict
          ? FINANCIAL_RECONCILIATION_FAILURE
          : result.declineReason,
      },
      client,
    );
    if (concurrentOutcome) return concurrentOutcome;
    return 'PROVIDER_PENDING';
  }

  const reconciliation = await reconcileConfirmedRefund(
    {
      paymentId: input.paymentId,
      actorId: input.actorId,
      actorType,
      provider: input.provider.name,
      externalRef:
        reserved.payment.refunds[0]?.externalRef ??
        (providerAction === 'CALL_PROVIDER' ? result.externalRef : null),
    },
    client,
  );
  if (reconciliation === 'COMPLETED' || reconciliation === 'REPLAYED') {
    return reconciliation;
  }
  return reconciliation === 'NOT_FOUND' ? 'NOT_FOUND' : 'NOT_ACTIONABLE';
}
