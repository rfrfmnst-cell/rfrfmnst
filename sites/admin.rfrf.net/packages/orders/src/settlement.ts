import { reviewedCommerceRiskLevel } from '@rafraf/shared/product-os/reviewed-commerce-risk';
import {
  ActorType,
  DisputeStatus,
  EscrowEntryType,
  OrderStatus,
  PaymentStatus,
  PayoutStatus,
  Prisma,
  prisma,
  RiskLevel,
} from '@rafraf/db';
import { assertOrderTransition } from '@rafraf/shared/workflow/order-state';
import { lockReviewedRisks } from './risk-assessment-writer.ts';
import { isExternalCarrierDeliveryProof } from '@rafraf/shared/workflow/shipment-proof';
import {
  decideSettlement,
  resolveComplaintWindowHours,
  splitEscrowSettlement,
  type SettlementDecision,
  type SettlementRiskLevel,
} from '@rafraf/shared/workflow/order-settlement';
import { refundOperationBlocksFinancialRelease } from './provider-refund-reconciliation.ts';

export type SettlementOutcome =
  | 'RELEASED'
  | 'REPLAYED'
  | 'WINDOW_OPEN'
  | 'ESCALATED_TO_OPS'
  | 'BLOCKED_BY_COMPLAINT'
  | 'NOT_ACTIONABLE'
  | 'NOT_FOUND'
  | 'MISSING_COST_BASIS'
  | 'MISSING_HOLD'
  | 'FINANCIAL_INPUT_MISMATCH'
  | 'CARRIER_DELIVERY_REQUIRED';

export interface SettleOrderInput {
  orderId: string;
  /**
   * يقيّد الطلب بمالكه حين يكون المستدعي هو العميل نفسه. غيابه يعني مسار
   * عمليات، وهو المسار الوحيد الذي يجوز له رؤية طلب أي عميل.
   */
  customerId?: string;
  /** معرّف الفاعل للتدقيق: مشغّل الإدارة، أو الكانس الآلي. */
  actorId: string;
  actorType: ActorType;
  /** يتخطّى انتظار النافذة وحده؛ لا يتخطّى شكوى ولا خطراً. */
  customerConfirmed?: boolean;
  /** تجاوز بشري صريح بعد مراجعة التصعيد. */
  opsOverride?: boolean;
  now?: Date;
}

export interface SettleOrderResult {
  outcome: SettlementOutcome;
  status?: OrderStatus;
  payout?: number;
  fee?: number;
}

function complaintWindowHours(): number {
  return resolveComplaintWindowHours(process.env.COMPLAINT_WINDOW_HOURS);
}

function toSettlementRisk(level: RiskLevel | null): SettlementRiskLevel | null {
  return level ? (level as SettlementRiskLevel) : null;
}

function highestSettlementRisk(
  levels: Array<RiskLevel | null | undefined>,
): SettlementRiskLevel | null {
  if (levels.some((level) => !level)) return null;
  for (const level of [
    RiskLevel.BLOCKED,
    RiskLevel.HIGH,
    RiskLevel.MEDIUM,
    RiskLevel.LOW,
  ]) {
    if (levels.includes(level)) return toSettlementRisk(level);
  }
  return null;
}

/**
 * صياغة القرار كنتيجة. `switch` لا جدول بحث: النوع يثبت أن كل قرار مغطّى،
 * فإضافة قرار جديد لاحقاً تفشل عند الترجمة بدل أن تعيد `undefined` بصمت.
 */
function outcomeFor(
  decision: Exclude<SettlementDecision, 'RELEASE'>,
): SettlementOutcome {
  switch (decision) {
    case 'WINDOW_OPEN':
      return 'WINDOW_OPEN';
    case 'ESCALATE_TO_OPS':
      return 'ESCALATED_TO_OPS';
    case 'BLOCKED_BY_COMPLAINT':
      return 'BLOCKED_BY_COMPLAINT';
  }
}

/**
 * يسوّي طلباً واحداً: يغلق نافذة الشكوى ثم يفرج عن الضمان.
 *
 * الانتقالان والقيود المالية كلها في معاملة واحدة خلف قفل استشاري، لأن طلباً
 * يصل `PAYOUT_RELEASED` بلا قيود دفتر — أو العكس — فجوة محاسبية لا تُسوّى
 * بأثر رجعي.
 *
 * الدفتر: `RELEASE` بإشارة سالبة يفرّغ الضمان مقابل `HOLD` الموجب، ثم `PAYOUT`
 * و`FEE` يوثّقان وجهة المبلغ. رصيد الضمان يُحسب من HOLD وRELEASE وREFUND وحدها؛
 * قيدا الوجهة توزيع لا حركة، فجمعهما مع RELEASE يحتسب المبلغ مرتين.
 */
export async function settleDeliveredOrder(
  input: SettleOrderInput,
  client: typeof prisma = prisma,
): Promise<SettleOrderResult> {
  const now = input.now ?? new Date();
  const windowHours = complaintWindowHours();

  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order-settlement:${input.orderId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order-financial-resolution:${input.orderId}`}))`;

    const order = await tx.order.findFirst({
      where: input.customerId
        ? { id: input.orderId, customerId: input.customerId }
        : { id: input.orderId },
      select: {
        id: true,
        status: true,
        supplierId: true,
        supplier: { select: { status: true } },
        quoteId: true,
        totalAmount: true,
        currency: true,
        deliveredAt: true,
        customerConfirmedAt: true,
      },
    });
    if (!order || !order.supplierId) return { outcome: 'NOT_FOUND' };
    if (order.status === OrderStatus.PAYOUT_RELEASED) {
      return { outcome: 'REPLAYED', status: order.status };
    }
    if (order.status !== OrderStatus.COMPLAINT_WINDOW) {
      return { outcome: 'NOT_ACTIONABLE', status: order.status };
    }
    // النافذة لا تُفتح بلا تسليم موثّق، فغياب الطابع الزمني هنا يعني بيانات
    // غير متّسقة لا مجرّد انتظار.
    if (!order.deliveredAt)
      return { outcome: 'NOT_ACTIONABLE', status: order.status };

    await lockReviewedRisks(tx, {
      supplierId: order.supplierId,
      quoteId: order.quoteId,
    });
    const [
      openComplaints,
      supplierRisk,
      quoteRisk,
      hold,
      existingRelease,
      existingPayoutLedger,
      existingSupplierPayout,
      landedCost,
      refundOperations,
      shipmentEvidence,
    ] = await Promise.all([
      tx.dispute.count({
        where: {
          orderId: order.id,
          status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] },
        },
      }),
      tx.riskAssessment.findFirst({
        where: { entityType: 'supplier', entityId: order.supplierId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { riskLevel: true, assessedBy: true, reasons: true },
      }),
      tx.riskAssessment.findFirst({
        where: { entityType: 'quote', entityId: order.quoteId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { riskLevel: true, assessedBy: true, reasons: true },
      }),
      tx.escrowLedgerEntry.findFirst({
        where: { orderId: order.id, entryType: EscrowEntryType.HOLD },
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
        where: { orderId: order.id, entryType: EscrowEntryType.RELEASE },
        select: { id: true },
      }),
      tx.escrowLedgerEntry.findFirst({
        where: { orderId: order.id, entryType: EscrowEntryType.PAYOUT },
        select: { id: true },
      }),
      tx.supplierPayout.findFirst({
        where: {
          orderId: order.id,
          status: { not: PayoutStatus.CANCELLED },
        },
        select: { id: true },
      }),
      tx.landedCost.findUnique({
        where: { quoteId: order.quoteId },
        select: { supplierPrice: true, currency: true },
      }),
      tx.paymentRefund.findMany({
        where: {
          orderId: order.id,
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
      tx.shipment.findMany({
        where: { orderId: order.id },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: { provider: true, trackingNumber: true, status: true },
      }),
    ]);

    // A provider call may be in flight outside its reservation transaction.
    // Releasing escrow while that operation exists could pay both parties.
    if (
      refundOperations.some((operation) =>
        refundOperationBlocksFinancialRelease(operation, hold),
      )
    ) {
      return { outcome: 'NOT_ACTIONABLE', status: order.status };
    }
    if (!shipmentEvidence.some(isExternalCarrierDeliveryProof)) {
      return { outcome: 'CARRIER_DELIVERY_REQUIRED', status: order.status };
    }

    // قيد إفراج قائم مع طلب لم يبلغ PAYOUT_RELEASED يعني تسوية نصف مكتملة.
    // الرفض هنا أأمن من إصدار إفراج ثانٍ على المبلغ نفسه.
    if (existingRelease || existingPayoutLedger || existingSupplierPayout) {
      return { outcome: 'REPLAYED', status: order.status };
    }
    if (!hold) return { outcome: 'MISSING_HOLD' };
    if (!landedCost) return { outcome: 'MISSING_COST_BASIS' };
    if (
      !hold.paymentId ||
      !hold.payment ||
      hold.currency !== order.currency ||
      hold.payment.currency !== order.currency ||
      landedCost.currency !== order.currency ||
      hold.payment.orderId !== order.id ||
      (hold.payment.status !== PaymentStatus.CAPTURED &&
        hold.payment.status !== PaymentStatus.HELD) ||
      Number(hold.amount) !== Number(order.totalAmount) ||
      Number(hold.payment.amount) !== Number(hold.amount)
    ) {
      return { outcome: 'FINANCIAL_INPUT_MISMATCH', status: order.status };
    }

    if (input.opsOverride && input.actorType !== ActorType.ADMIN) {
      return { outcome: 'NOT_ACTIONABLE', status: order.status };
    }
    const decision = input.opsOverride
      ? 'RELEASE'
      : decideSettlement({
          deliveredAt: order.deliveredAt,
          now,
          windowHours,
          riskLevel:
            order.supplier?.status === 'APPROVED'
              ? highestSettlementRisk([
                  reviewedCommerceRiskLevel(supplierRisk),
                  reviewedCommerceRiskLevel(quoteRisk),
                ])
              : 'HIGH',
          hasOpenComplaint: openComplaints > 0,
          customerConfirmed:
            input.customerConfirmed ?? order.customerConfirmedAt !== null,
        });

    // التجاوز البشري يراجع الخطر، ولا يتجاوز شكوى مفتوحة: تلك تُحسم في مسارها.
    if (input.opsOverride && openComplaints > 0) {
      return { outcome: 'BLOCKED_BY_COMPLAINT', status: order.status };
    }
    if (decision !== 'RELEASE') {
      return { outcome: outcomeFor(decision), status: order.status };
    }

    // المبلغ المحتجز فعلاً هو مصدر الحقيقة، لا الإجمالي المسجّل على الطلب.
    const split = splitEscrowSettlement({
      totalAmount: Number(hold.amount),
      supplierPrice: Number(landedCost.supplierPrice),
    });

    assertOrderTransition('COMPLAINT_WINDOW', 'CLOSED');
    const closed = await tx.order.updateMany({
      where: { id: order.id, status: OrderStatus.COMPLAINT_WINDOW },
      data: { status: OrderStatus.CLOSED },
    });
    if (closed.count !== 1) {
      return { outcome: 'NOT_ACTIONABLE', status: order.status };
    }
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        fromStatus: OrderStatus.COMPLAINT_WINDOW,
        toStatus: OrderStatus.CLOSED,
        actorId: input.actorId,
        actorType: input.actorType,
        note: input.opsOverride
          ? 'أغلقت العمليات نافذة الشكوى بعد مراجعة التصعيد'
          : 'انتهت نافذة الشكوى دون اعتراض',
      },
    });

    assertOrderTransition('CLOSED', 'PAYOUT_RELEASED');
    const released = await tx.order.updateMany({
      where: { id: order.id, status: OrderStatus.CLOSED },
      data: { status: OrderStatus.PAYOUT_RELEASED },
    });
    if (released.count !== 1) {
      throw new Error('Closed order could not reach payout release');
    }

    await tx.escrowLedgerEntry.create({
      data: {
        orderId: order.id,
        supplierId: order.supplierId,
        entryType: EscrowEntryType.RELEASE,
        amount: new Prisma.Decimal(split.release).negated(),
        currency: order.currency,
        note: 'إفراج عن الضمان بعد إغلاق نافذة الشكوى',
        createdBy: input.actorId,
      },
    });
    await tx.escrowLedgerEntry.create({
      data: {
        orderId: order.id,
        supplierId: order.supplierId,
        entryType: EscrowEntryType.PAYOUT,
        amount: new Prisma.Decimal(split.payout),
        currency: order.currency,
        note: 'مستحق المورد عن القطعة',
        createdBy: input.actorId,
      },
    });
    if (split.fee > 0) {
      await tx.escrowLedgerEntry.create({
        data: {
          orderId: order.id,
          supplierId: order.supplierId,
          entryType: EscrowEntryType.FEE,
          amount: new Prisma.Decimal(split.fee),
          currency: order.currency,
          note: 'ما تحتفظ به رفرف: الهامش والتكاليف المحمّلة',
          createdBy: input.actorId,
        },
      });
    }

    await tx.supplierPayout.create({
      data: {
        supplierId: order.supplierId,
        orderId: order.id,
        amount: new Prisma.Decimal(split.payout),
        currency: order.currency,
        status: PayoutStatus.PENDING,
      },
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        fromStatus: OrderStatus.CLOSED,
        toStatus: OrderStatus.PAYOUT_RELEASED,
        actorId: input.actorId,
        actorType: input.actorType,
        note: 'أُفرج عن الضمان وسُجّل مستحق المورد',
      },
    });

    // لا مبالغ في سجل التدقيق: القيم في الدفتر، وتكرارها هنا يفتح نسخة ثانية
    // من الحقيقة المالية يمكن أن تتعارض مع الأولى.
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorType: input.actorType,
        action: 'order.escrow.released',
        entityType: 'order',
        entityId: order.id,
        before: { status: OrderStatus.COMPLAINT_WINDOW },
        after: {
          status: OrderStatus.PAYOUT_RELEASED,
          escrowAction: 'RELEASE',
          opsOverride: Boolean(input.opsOverride),
          windowHours,
        },
      },
    });

    return {
      outcome: 'RELEASED',
      status: OrderStatus.PAYOUT_RELEASED,
      payout: split.payout,
      fee: split.fee,
    };
  });
}
