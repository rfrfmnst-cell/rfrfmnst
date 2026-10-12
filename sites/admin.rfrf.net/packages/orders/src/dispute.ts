import {
  ActorType,
  DisputeStatus,
  EscrowEntryType,
  OrderStatus,
  PaymentRefundStatus,
  PaymentStatus,
  PayoutStatus,
  Prisma,
  prisma,
} from '@rafraf/db';
import { splitEscrowSettlement } from '@rafraf/shared/workflow/order-settlement';
import { assertOrderTransition } from '@rafraf/shared/workflow/order-state';
import { isSupplierRejectionDisputeReason } from '@rafraf/shared';
import { refundOperationBlocksFinancialRelease } from './provider-refund-reconciliation.ts';
export {
  CUSTOMER_DISPUTE_REASONS,
  openCustomerDispute,
  parseCustomerDisputeReason,
  type CustomerDisputeReason,
  type OpenCustomerDisputeOutcome,
  type OpenCustomerDisputeResult,
} from './customer-dispute-open.ts';

function cleanDescription(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/gu, ' ').trim().slice(0, 1_000);
  return clean.length >= 10 ? clean : null;
}

export type RejectCustomerDisputeOutcome =
  | 'RELEASED'
  | 'REPLAYED'
  | 'INVALID_INPUT'
  | 'NOT_ACTIONABLE'
  | 'NOT_FOUND'
  | 'MISSING_HOLD'
  | 'FINANCIAL_INPUT_MISMATCH'
  | 'MISSING_COST_BASIS';

/**
 * Resolves an invalid complaint in the supplier's favour and settles escrow.
 * A customer refund deliberately remains in `refundPayment`, because it must
 * complete the external provider reconciliation before the dispute is closed.
 */
export async function rejectCustomerDispute(
  input: { disputeId: string; actorId: string; resolutionNote: unknown },
  client: typeof prisma = prisma,
): Promise<RejectCustomerDisputeOutcome> {
  const resolutionNote = cleanDescription(input.resolutionNote)?.slice(0, 500);
  if (!resolutionNote) return 'INVALID_INPUT';

  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dispute-resolution:${input.disputeId}`}))`;
    const scope = await tx.dispute.findUnique({
      where: { id: input.disputeId },
      select: { orderId: true },
    });
    if (!scope) return 'NOT_FOUND';
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order-financial-resolution:${scope.orderId}`}))`;

    const dispute = await tx.dispute.findUnique({
      where: { id: input.disputeId },
      include: {
        order: {
          select: {
            id: true,
            status: true,
            supplierId: true,
            quoteId: true,
            totalAmount: true,
            currency: true,
          },
        },
      },
    });
    if (!dispute) return 'NOT_FOUND';
    if (
      dispute.status === DisputeStatus.RESOLVED_REJECTED &&
      dispute.order.status === OrderStatus.PAYOUT_RELEASED
    ) {
      return 'REPLAYED';
    }
    if (
      (dispute.status !== DisputeStatus.OPEN &&
        dispute.status !== DisputeStatus.UNDER_REVIEW) ||
      dispute.order.status !== OrderStatus.DISPUTED ||
      !dispute.order.supplierId ||
      isSupplierRejectionDisputeReason(dispute.reason)
    ) {
      return 'NOT_ACTIONABLE';
    }

    const [
      activeCount,
      hold,
      settled,
      landedCost,
      existingPayout,
      refundOperations,
    ] = await Promise.all([
      tx.dispute.count({
        where: {
          orderId: dispute.orderId,
          status: {
            in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW],
          },
        },
      }),
      tx.escrowLedgerEntry.findFirst({
        where: {
          orderId: dispute.orderId,
          entryType: EscrowEntryType.HOLD,
        },
        select: {
          amount: true,
          currency: true,
          paymentId: true,
          payment: {
            select: {
              orderId: true,
              status: true,
              amount: true,
              currency: true,
            },
          },
        },
      }),
      tx.escrowLedgerEntry.findFirst({
        where: {
          orderId: dispute.orderId,
          entryType: {
            in: [
              EscrowEntryType.RELEASE,
              EscrowEntryType.REFUND,
              EscrowEntryType.PAYOUT,
            ],
          },
        },
        select: { id: true },
      }),
      tx.landedCost.findUnique({
        where: { quoteId: dispute.order.quoteId },
        select: { supplierPrice: true, currency: true },
      }),
      tx.supplierPayout.findFirst({
        where: {
          orderId: dispute.orderId,
          status: { not: PayoutStatus.CANCELLED },
        },
        select: { id: true },
      }),
      tx.paymentRefund.findMany({
        where: {
          orderId: dispute.orderId,
        },
        select: {
          status: true,
          failureCode: true,
          amount: true,
          currency: true,
          payment: {
            select: { status: true, amount: true, currency: true },
          },
        },
      }),
    ]);
    if (
      activeCount !== 1 ||
      settled ||
      existingPayout ||
      refundOperations.some((operation) =>
        refundOperationBlocksFinancialRelease(operation, hold),
      )
    ) {
      return 'NOT_ACTIONABLE';
    }
    if (!hold) return 'MISSING_HOLD';
    if (!landedCost) return 'MISSING_COST_BASIS';
    if (
      !hold.paymentId ||
      !hold.payment ||
      hold.currency !== dispute.order.currency ||
      hold.payment.currency !== dispute.order.currency ||
      landedCost.currency !== dispute.order.currency ||
      hold.payment.orderId !== dispute.order.id ||
      (hold.payment.status !== PaymentStatus.CAPTURED &&
        hold.payment.status !== PaymentStatus.HELD) ||
      Number(hold.amount) !== Number(dispute.order.totalAmount) ||
      Number(hold.payment.amount) !== Number(hold.amount)
    ) {
      return 'FINANCIAL_INPUT_MISMATCH';
    }

    const split = splitEscrowSettlement({
      totalAmount: Number(hold.amount),
      supplierPrice: Number(landedCost.supplierPrice),
    });
    const resolved = await tx.dispute.updateMany({
      where: {
        id: dispute.id,
        status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] },
      },
      data: {
        status: DisputeStatus.RESOLVED_REJECTED,
        resolutionNote,
      },
    });
    if (resolved.count !== 1) return 'NOT_ACTIONABLE';

    assertOrderTransition('DISPUTED', 'CLOSED');
    const closed = await tx.order.updateMany({
      where: { id: dispute.orderId, status: OrderStatus.DISPUTED },
      data: { status: OrderStatus.CLOSED },
    });
    if (closed.count !== 1) {
      throw new Error('Disputed order changed concurrently');
    }
    await tx.orderEvent.create({
      data: {
        orderId: dispute.orderId,
        fromStatus: OrderStatus.DISPUTED,
        toStatus: OrderStatus.CLOSED,
        actorType: ActorType.ADMIN,
        actorId: input.actorId,
        note: 'رفضت العمليات الشكوى بعد المراجعة',
      },
    });

    assertOrderTransition('CLOSED', 'PAYOUT_RELEASED');
    const released = await tx.order.updateMany({
      where: { id: dispute.orderId, status: OrderStatus.CLOSED },
      data: { status: OrderStatus.PAYOUT_RELEASED },
    });
    if (released.count !== 1) {
      throw new Error('Closed order changed concurrently');
    }

    await tx.escrowLedgerEntry.create({
      data: {
        orderId: dispute.orderId,
        supplierId: dispute.order.supplierId,
        entryType: EscrowEntryType.RELEASE,
        amount: new Prisma.Decimal(split.release).negated(),
        currency: dispute.order.currency,
        note: 'إفراج الضمان بعد رفض الشكوى',
        createdBy: input.actorId,
      },
    });
    await tx.escrowLedgerEntry.create({
      data: {
        orderId: dispute.orderId,
        supplierId: dispute.order.supplierId,
        entryType: EscrowEntryType.PAYOUT,
        amount: new Prisma.Decimal(split.payout),
        currency: dispute.order.currency,
        note: 'مستحق المورد بعد حسم الشكوى',
        createdBy: input.actorId,
      },
    });
    if (split.fee > 0) {
      await tx.escrowLedgerEntry.create({
        data: {
          orderId: dispute.orderId,
          supplierId: dispute.order.supplierId,
          entryType: EscrowEntryType.FEE,
          amount: new Prisma.Decimal(split.fee),
          currency: dispute.order.currency,
          note: 'هامش وتكاليف رفرف',
          createdBy: input.actorId,
        },
      });
    }
    await tx.supplierPayout.create({
      data: {
        supplierId: dispute.order.supplierId,
        orderId: dispute.orderId,
        amount: new Prisma.Decimal(split.payout),
        currency: dispute.order.currency,
        status: PayoutStatus.PENDING,
      },
    });
    await tx.orderEvent.create({
      data: {
        orderId: dispute.orderId,
        fromStatus: OrderStatus.CLOSED,
        toStatus: OrderStatus.PAYOUT_RELEASED,
        actorType: ActorType.ADMIN,
        actorId: input.actorId,
        note: 'أُفرج عن الضمان وسُجّل مستحق المورد',
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorType: ActorType.ADMIN,
        action: 'dispute.resolved.supplier',
        entityType: 'dispute',
        entityId: dispute.id,
        before: {
          disputeStatus: dispute.status,
          orderStatus: OrderStatus.DISPUTED,
        },
        after: {
          disputeStatus: DisputeStatus.RESOLVED_REJECTED,
          orderStatus: OrderStatus.PAYOUT_RELEASED,
          escrowAction: 'RELEASE',
        },
      },
    });
    return 'RELEASED';
  });
}

export type ResolveRefundedDisputesOutcome =
  'RESOLVED' | 'REPLAYED' | 'INVALID_INPUT' | 'NOT_ACTIONABLE' | 'NOT_FOUND';

/**
 * Finishes the database side of a provider-confirmed refund. This is separate
 * and replay-safe because the process can stop after the provider and payment
 * reconciliation succeed but before the dispute row is updated.
 */
export async function resolveRefundedOrderDisputes(
  input: { disputeId: string; actorId: string; resolutionNote: unknown },
  client: typeof prisma = prisma,
): Promise<ResolveRefundedDisputesOutcome> {
  const resolutionNote = cleanDescription(input.resolutionNote)?.slice(0, 500);
  if (!resolutionNote) return 'INVALID_INPUT';

  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dispute-resolution:${input.disputeId}`}))`;
    const scope = await tx.dispute.findUnique({
      where: { id: input.disputeId },
      select: { orderId: true },
    });
    if (!scope) return 'NOT_FOUND';
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order-financial-resolution:${scope.orderId}`}))`;

    const dispute = await tx.dispute.findUnique({
      where: { id: input.disputeId },
      include: { order: { select: { status: true } } },
    });
    if (!dispute) return 'NOT_FOUND';
    if (
      dispute.status === DisputeStatus.RESOLVED_REFUND &&
      dispute.order.status === OrderStatus.REFUNDED
    ) {
      return 'REPLAYED';
    }
    if (
      (dispute.status !== DisputeStatus.OPEN &&
        dispute.status !== DisputeStatus.UNDER_REVIEW) ||
      dispute.order.status !== OrderStatus.REFUNDED
    ) {
      return 'NOT_ACTIONABLE';
    }

    const [completedRefunds, activeCount] = await Promise.all([
      tx.paymentRefund.count({
        where: {
          orderId: scope.orderId,
          status: PaymentRefundStatus.COMPLETED,
        },
      }),
      tx.dispute.count({
        where: {
          orderId: scope.orderId,
          status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] },
        },
      }),
    ]);
    if (completedRefunds < 1 || activeCount !== 1) return 'NOT_ACTIONABLE';

    const resolved = await tx.dispute.updateMany({
      where: {
        id: dispute.id,
        status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] },
      },
      data: {
        status: DisputeStatus.RESOLVED_REFUND,
        resolutionNote,
      },
    });
    if (resolved.count !== 1) return 'REPLAYED';

    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorType: ActorType.ADMIN,
        action: 'dispute.resolved.refund',
        entityType: 'dispute',
        entityId: dispute.id,
        before: { disputeStatus: dispute.status },
        after: {
          disputeStatus: DisputeStatus.RESOLVED_REFUND,
          orderStatus: OrderStatus.REFUNDED,
          escrowAction: 'REFUND',
          resolvedCount: resolved.count,
        },
      },
    });
    return 'RESOLVED';
  });
}
