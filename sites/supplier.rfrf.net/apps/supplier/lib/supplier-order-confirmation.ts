import {
  ActorType,
  DisputeStatus,
  OrderStatus,
  Prisma,
  prisma,
  SupplierStatus,
} from '@rafraf/db';
import {
  assertOrderTransition,
  holdsEscrowMoney,
} from '@rafraf/shared/workflow/order-state';
import { SUPPLIER_REJECTION_DISPUTE_PREFIX } from '@rafraf/shared';

export const SUPPLIER_REJECTION_REASONS = {
  OUT_OF_STOCK: 'نفاد المخزون',
  PRICE_CHANGED: 'تغير السعر',
  FITMENT_CONCERN: 'ملاحظة على توافق القطعة',
  SLA_UNAVAILABLE: 'تعذر الالتزام بمدة التوريد',
  OTHER: 'سبب تشغيلي آخر',
} as const;

export type SupplierRejectionReason = keyof typeof SUPPLIER_REJECTION_REASONS;
export type SupplierOrderDecision = 'ACCEPT' | 'REJECT';
export type SupplierOrderDecisionOutcome =
  | 'APPLIED'
  | 'REPLAYED'
  | 'INVALID_REASON'
  | 'NOT_AVAILABLE'
  | 'NOT_ACTIONABLE'
  | 'SUPPLIER_NOT_APPROVED';

export interface SupplierOrderDecisionInput {
  supplierId: string;
  orderId: string;
  decision: SupplierOrderDecision;
  reasonCode?: string;
}

export interface SupplierOrderDecisionResult {
  outcome: SupplierOrderDecisionOutcome;
  status?: OrderStatus;
}

async function ensureSupplierRejectionDispute(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    customerId: string;
    reasonCode: SupplierRejectionReason;
  },
): Promise<void> {
  const existing = await tx.dispute.findFirst({
    where: {
      orderId: input.orderId,
      status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] },
    },
    select: { id: true },
  });
  if (existing) return;

  await tx.dispute.create({
    data: {
      orderId: input.orderId,
      customerId: input.customerId,
      reason: `${SUPPLIER_REJECTION_DISPUTE_PREFIX}${input.reasonCode}`,
      description: SUPPLIER_REJECTION_REASONS[input.reasonCode],
      status: DisputeStatus.OPEN,
    },
  });
}

const DECISION_TARGET: Record<SupplierOrderDecision, OrderStatus> = {
  ACCEPT: OrderStatus.SUPPLIER_ACCEPTED,
  REJECT: OrderStatus.DISPUTED,
};

export function parseSupplierRejectionReason(
  value: unknown,
): SupplierRejectionReason | null {
  if (typeof value !== 'string') return null;
  return Object.hasOwn(SUPPLIER_REJECTION_REASONS, value)
    ? (value as SupplierRejectionReason)
    : null;
}

/**
 * Applies the supplier's one-time fulfillment decision behind a tenant-scoped
 * lock and compare-and-swap. A rejection deliberately opens DISPUTED while the
 * escrow remains held; refund or payout is a separate admin-controlled flow.
 */
export async function decideSupplierOrder(
  input: SupplierOrderDecisionInput,
  client: typeof prisma = prisma,
): Promise<SupplierOrderDecisionResult> {
  const reasonCode =
    input.decision === 'REJECT'
      ? parseSupplierRejectionReason(input.reasonCode)
      : null;
  if (input.decision === 'REJECT' && !reasonCode) {
    return { outcome: 'INVALID_REASON' };
  }

  const target = DECISION_TARGET[input.decision];

  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`supplier-order-decision:${input.orderId}`}))`;

    // Re-read the tenant status inside the write transaction. A stale session
    // must not let a LIMITED/SUSPENDED supplier accept a paid order.
    const supplier = await tx.supplier.findUnique({
      where: { id: input.supplierId },
      select: { status: true },
    });
    if (!supplier || supplier.status !== SupplierStatus.APPROVED) {
      return { outcome: 'SUPPLIER_NOT_APPROVED' };
    }

    // Tenant ownership is enforced in both the read and the CAS below. Returning
    // NOT_AVAILABLE avoids confirming that another tenant's order exists.
    const order = await tx.order.findFirst({
      where: { id: input.orderId, supplierId: input.supplierId },
      select: { id: true, customerId: true, status: true },
    });
    if (!order) return { outcome: 'NOT_AVAILABLE' };
    if (order.status === target) {
      // يصلح بيانات الرفض القديمة التي انتقلت إلى DISPUTED قبل إضافة سجل
      // النزاع. القفل أعلاه يجعل الإصلاح idempotent ولا ينشئ صفاً مكرراً.
      if (input.decision === 'REJECT' && reasonCode) {
        await ensureSupplierRejectionDispute(tx, {
          orderId: order.id,
          customerId: order.customerId,
          reasonCode,
        });
      }
      return { outcome: 'REPLAYED', status: target };
    }
    if (order.status !== OrderStatus.AWAITING_SUPPLIER_CONFIRMATION) {
      return { outcome: 'NOT_ACTIONABLE', status: order.status };
    }

    assertOrderTransition('AWAITING_SUPPLIER_CONFIRMATION', target);
    if (input.decision === 'REJECT' && !holdsEscrowMoney(target)) {
      throw new Error('Supplier rejection must keep escrow held');
    }

    const moved = await tx.order.updateMany({
      where: {
        id: order.id,
        supplierId: input.supplierId,
        status: OrderStatus.AWAITING_SUPPLIER_CONFIRMATION,
      },
      data: { status: target },
    });

    if (moved.count !== 1) {
      const latest = await tx.order.findFirst({
        where: { id: input.orderId, supplierId: input.supplierId },
        select: { status: true },
      });
      if (latest?.status === target) {
        return { outcome: 'REPLAYED', status: target };
      }
      return { outcome: 'NOT_ACTIONABLE', status: latest?.status };
    }

    const reasonLabel = reasonCode
      ? SUPPLIER_REJECTION_REASONS[reasonCode]
      : null;
    const action =
      input.decision === 'ACCEPT'
        ? 'order.supplier.accepted'
        : 'order.supplier.rejected';

    // حالة DISPUTED بلا سجل Dispute غير مرئية لطابور العمليات ولا تمنع
    // التسوية التي تعتمد على الجدول. إنشاء الاثنين داخل المعاملة نفسها يحفظ
    // سلامة الضمان ويمنع حالة مالية نصف مكتملة.
    if (input.decision === 'REJECT' && reasonCode) {
      await ensureSupplierRejectionDispute(tx, {
        orderId: order.id,
        customerId: order.customerId,
        reasonCode,
      });
    }

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        fromStatus: OrderStatus.AWAITING_SUPPLIER_CONFIRMATION,
        toStatus: target,
        actorType: ActorType.SUPPLIER,
        actorId: input.supplierId,
        note:
          input.decision === 'ACCEPT'
            ? 'قبل المورد تنفيذ الطلب'
            : `تعذر على المورد التنفيذ: ${reasonLabel}. المبلغ باقٍ في الضمان حتى قرار العمليات.`,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: input.supplierId,
        actorType: ActorType.SUPPLIER,
        action,
        entityType: 'order',
        entityId: order.id,
        before: { status: OrderStatus.AWAITING_SUPPLIER_CONFIRMATION },
        after: {
          status: target,
          decision: input.decision,
          reasonCode,
          escrowAction: 'NONE',
        },
      },
    });

    return { outcome: 'APPLIED', status: target };
  });
}
