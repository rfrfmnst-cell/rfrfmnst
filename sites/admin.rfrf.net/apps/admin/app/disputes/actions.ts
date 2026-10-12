'use server';

import {
  ActorType,
  DisputeStatus,
  EscrowEntryType,
  OrderStatus,
  PaymentStatus,
  prisma,
} from '@rafraf/db';
import {
  refundPayment,
  rejectCustomerDispute,
  resolveRefundedOrderDisputes,
} from '@rafraf/orders';
import { edfaPayRefundProviderFromEnv } from '@rafraf/shared/payments/edfapay-refund-provider';
import { paymentRefundRoute } from '@rafraf/shared/payments/manual-payment-policy';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdminPermission } from '../../lib/require-admin-session';

function cleanId(value: FormDataEntryValue | null): string {
  return String(value ?? '')
    .trim()
    .slice(0, 64);
}

function cleanNote(value: FormDataEntryValue | null): string | null {
  const note = String(value ?? '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 500);
  return note.length >= 10 ? note : null;
}

function disputeRedirect(disputeId: string, status: string): never {
  redirect(
    `/disputes/${encodeURIComponent(disputeId)}?result=${encodeURIComponent(status)}`,
  );
}

export async function startDisputeReview(fd: FormData): Promise<void> {
  const admin = await requireAdminPermission('PAYMENT_WRITE');
  const disputeId = cleanId(fd.get('disputeId'));
  if (!disputeId) redirect('/disputes');

  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dispute-review:${disputeId}`}))`;
    const current = await tx.dispute.findUnique({
      where: { id: disputeId },
      select: { status: true },
    });
    if (!current) return 'not_found';
    if (current.status === DisputeStatus.UNDER_REVIEW) return 'reviewing';
    if (current.status !== DisputeStatus.OPEN) return 'not_actionable';

    const moved = await tx.dispute.updateMany({
      where: { id: disputeId, status: DisputeStatus.OPEN },
      data: { status: DisputeStatus.UNDER_REVIEW },
    });
    if (moved.count !== 1) return 'not_actionable';
    await tx.auditLog.create({
      data: {
        actorId: admin.userId,
        actorType: ActorType.ADMIN,
        action: 'dispute.review.started',
        entityType: 'dispute',
        entityId: disputeId,
        before: { status: DisputeStatus.OPEN },
        after: { status: DisputeStatus.UNDER_REVIEW },
      },
    });
    return 'reviewing';
  });

  revalidatePath('/disputes');
  revalidatePath(`/disputes/${disputeId}`);
  disputeRedirect(disputeId, outcome);
}

export async function rejectDisputeClaim(fd: FormData): Promise<void> {
  const admin = await requireAdminPermission('PAYMENT_WRITE');
  const disputeId = cleanId(fd.get('disputeId'));
  const resolutionNote = cleanNote(fd.get('resolutionNote'));
  if (!disputeId) redirect('/disputes');
  if (!resolutionNote) disputeRedirect(disputeId, 'invalid_note');

  let outcome: Awaited<ReturnType<typeof rejectCustomerDispute>>;
  try {
    outcome = await rejectCustomerDispute({
      disputeId,
      actorId: admin.userId,
      resolutionNote,
    });
  } catch (error) {
    console.error(
      'rejectDisputeClaim failed:',
      error instanceof Error ? error.name : 'UNKNOWN',
    );
    outcome = 'NOT_ACTIONABLE';
  }

  revalidatePath('/');
  revalidatePath('/disputes');
  revalidatePath(`/disputes/${disputeId}`);
  disputeRedirect(disputeId, outcome.toLowerCase());
}

export async function refundDisputeClaim(fd: FormData): Promise<void> {
  const admin = await requireAdminPermission('PAYMENT_WRITE');
  const disputeId = cleanId(fd.get('disputeId'));
  const resolutionNote = cleanNote(fd.get('resolutionNote'));
  const confirmOrderCode = String(fd.get('confirmOrderCode') ?? '')
    .trim()
    .slice(0, 40);
  if (!disputeId) redirect('/disputes');
  if (!resolutionNote || !confirmOrderCode) {
    disputeRedirect(disputeId, 'invalid_refund');
  }

  const dispute = await prisma.dispute.findFirst({
    where: {
      id: disputeId,
      status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] },
    },
    select: {
      orderId: true,
      order: {
        select: {
          code: true,
          status: true,
          escrow: {
            where: { entryType: EscrowEntryType.HOLD },
            orderBy: { createdAt: 'asc' },
            take: 2,
            select: {
              paymentId: true,
              payment: {
                select: { id: true, provider: true, status: true },
              },
            },
          },
        },
      },
    },
  });
  const payment =
    dispute?.order.escrow.length === 1
      ? dispute.order.escrow[0]?.payment
      : null;
  const paymentId = payment?.id;
  if (!dispute || confirmOrderCode !== dispute.order.code) {
    disputeRedirect(disputeId, 'refund_not_ready');
  }

  const refundRoute = paymentRefundRoute(payment?.provider);
  if (!refundRoute.allowed) {
    if (
      refundRoute.reason === 'manual_payment_refund_workflow_not_implemented'
    ) {
      disputeRedirect(disputeId, 'manual_refund_unavailable');
    }
    disputeRedirect(disputeId, 'refund_not_ready');
  }

  const paymentStatusEligible =
    dispute.order.status === OrderStatus.REFUNDED
      ? payment?.status === PaymentStatus.REFUNDED
      : payment?.status === PaymentStatus.CAPTURED ||
        payment?.status === PaymentStatus.HELD;
  if (!paymentStatusEligible) disputeRedirect(disputeId, 'refund_not_ready');

  const activeCount = await prisma.dispute.count({
    where: {
      orderId: dispute.orderId,
      status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] },
    },
  });
  if (activeCount !== 1) disputeRedirect(disputeId, 'multiple_active');

  // Repair a process interruption after the provider refund and payment/order
  // reconciliation succeeded. This path intentionally needs no live provider.
  if (dispute.order.status === OrderStatus.REFUNDED) {
    const repair = await resolveRefundedOrderDisputes({
      disputeId,
      actorId: admin.userId,
      resolutionNote,
    });
    revalidatePath('/');
    revalidatePath('/disputes');
    revalidatePath(`/disputes/${disputeId}`);
    disputeRedirect(disputeId, repair.toLowerCase());
  }

  const provider = edfaPayRefundProviderFromEnv();
  if (!paymentId || !provider) disputeRedirect(disputeId, 'refund_not_ready');

  let refundOutcome: Awaited<ReturnType<typeof refundPayment>>;
  try {
    refundOutcome = await refundPayment({
      paymentId,
      actorId: admin.userId,
      confirmOrderCode,
      provider,
    });
  } catch (error) {
    console.error(
      'refundDisputeClaim failed:',
      error instanceof Error ? error.name : 'UNKNOWN',
    );
    refundOutcome = 'NOT_ACTIONABLE';
  }

  if (refundOutcome === 'COMPLETED' || refundOutcome === 'REPLAYED') {
    const resolution = await resolveRefundedOrderDisputes({
      disputeId,
      actorId: admin.userId,
      resolutionNote,
    });
    if (resolution !== 'RESOLVED' && resolution !== 'REPLAYED') {
      refundOutcome = 'NOT_ACTIONABLE';
    }
  }

  revalidatePath('/');
  revalidatePath('/disputes');
  revalidatePath(`/disputes/${disputeId}`);
  disputeRedirect(disputeId, refundOutcome.toLowerCase());
}
