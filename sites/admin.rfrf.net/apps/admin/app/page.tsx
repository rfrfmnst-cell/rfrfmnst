import {
  OrderStatus,
  PaymentRefundStatus,
  PaymentStatus,
  prisma,
  QuoteStatus,
  RFQStatus,
  SupplierStatus,
} from '@rafraf/db';
import {
  DUPLICATE_CAPTURE_FAILURE,
  DUPLICATE_PARTIAL_REFUND_FAILURE,
  FINANCIAL_RECONCILIATION_FAILURE,
  PARTIAL_REFUND_FAILURE,
  REFUND_SIGNAL_PENDING,
  STALE_PAYMENT_INTAKE_MINUTES,
} from '@rafraf/orders';
import { requireAdminPermission } from '../lib/require-admin-session';
import { getComplianceQueue } from '../lib/compliance-queue';
import { CommandCenterFinance } from './command-center-finance';
import { CommandCenterOperations } from './command-center-operations';
import { CommandCenterSummary } from './command-center-summary';

export const dynamic = 'force-dynamic';

const REFUNDABLE_ORDER_STATUSES = [
  OrderStatus.PAID,
  OrderStatus.ESCROW_HELD,
  OrderStatus.AWAITING_SUPPLIER_CONFIRMATION,
  OrderStatus.SUPPLIER_ACCEPTED,
  OrderStatus.FITMENT_VERIFIED,
  OrderStatus.READY_TO_SHIP,
  OrderStatus.SHIPPED,
  OrderStatus.IN_TRANSIT,
  OrderStatus.CUSTOMS_REVIEW,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERED,
  OrderStatus.DISPUTED,
] as const;

const CRITICAL_REFUND_FAILURES = [
  FINANCIAL_RECONCILIATION_FAILURE,
  PARTIAL_REFUND_FAILURE,
  DUPLICATE_CAPTURE_FAILURE,
  DUPLICATE_PARTIAL_REFUND_FAILURE,
  REFUND_SIGNAL_PENDING,
] as const;

export default async function CommandCenter() {
  const admin = await requireAdminPermission('OPERATIONS_READ');
  const canManagePayments = admin.permissions.includes('PAYMENT_WRITE');
  const canReviewSuppliers = admin.permissions.includes('SUPPLIER_WRITE');
  const stalePaymentBefore = new Date(
    Date.now() - STALE_PAYMENT_INTAKE_MINUTES * 60_000,
  );
  const [
    rfqs,
    statusGroups,
    aiQuality,
    aiRecent,
    reviewCount,
    supplierGroups,
    pendingSuppliers,
    draftOffers,
    orders,
    paymentCount,
    escrowHold,
    shipments,
    disputeCount,
    complianceCount,
    revenue,
    pendingPayouts,
    criticalRefundOperations,
    ordinaryRefundablePayments,
    stalePaymentIntakes,
  ] = await Promise.all([
    prisma.rFQ.findMany({
      orderBy: { createdAt: 'desc' },
      take: 9,
      include: {
        customer: { include: { user: true } },
        vehicle: true,
        items: { include: { _count: { select: { quotes: true } } } },
        _count: { select: { evidence: true } },
      },
    }),
    prisma.rFQ.groupBy({ by: ['status'], _count: true }),
    prisma.aIDecision.aggregate({
      _avg: { confidence: true },
      _count: { id: true },
    }),
    prisma.aIDecision.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        kind: true,
        confidence: true,
        humanReviewRequired: true,
        entityType: true,
        createdAt: true,
      },
    }),
    prisma.rFQItem.count({ where: { humanReviewRequired: true } }),
    prisma.supplier.groupBy({ by: ['status'], _count: true }),
    prisma.supplier.findMany({
      where: {
        status: { in: [SupplierStatus.PENDING, SupplierStatus.UNDER_REVIEW] },
      },
      orderBy: { createdAt: 'desc' },
      take: 4,
      select: {
        id: true,
        businessName: true,
        city: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.quote.count({ where: { status: QuoteStatus.DRAFT } }),
    prisma.order.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 7,
      include: {
        customer: { include: { user: true } },
        supplier: true,
        quote: true,
      },
    }),
    prisma.order.count({ where: { status: OrderStatus.AWAITING_PAYMENT } }),
    // رصيد الضمان حركةٌ صافية لا مجموع احتجازات: HOLD موجب، وRELEASE وREFUND
    // سالبان بالاتفاقية نفسها. جمع HOLD وحده كان يعرض مالاً غادر الضمان فعلاً
    // على أنه محتجز. قيدا PAYOUT وFEE توزيعٌ لوجهة المبلغ لا حركة ضمان، فلا
    // يدخلان هذا الحساب وإلا احتُسب المبلغ مرتين.
    prisma.escrowLedgerEntry.aggregate({
      where: { entryType: { in: ['HOLD', 'RELEASE', 'REFUND'] } },
      _sum: { amount: true },
    }),
    prisma.shipment.groupBy({ by: ['status'], _count: true }),
    prisma.dispute.count({
      where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } },
    }),
    getComplianceQueue().then((queue) => queue.length),
    prisma.order.aggregate({ _sum: { totalAmount: true } }),
    prisma.supplierPayout.findMany({
      where: { status: { in: ['PENDING', 'SCHEDULED'] } },
      orderBy: { createdAt: 'asc' },
      take: 10,
      include: {
        supplier: { select: { businessName: true } },
        order: { select: { code: true, status: true } },
      },
    }),
    // الاستثناءات المالية طابور مستقل من سجل الاسترداد نفسه؛ لا تخفيه حالة
    // الطلب أو الدفعة بعد صرف المورد أو أثناء نافذة الشكوى.
    prisma.paymentRefund.findMany({
      where: {
        OR: [
          {
            status: {
              in: [
                PaymentRefundStatus.REQUESTED,
                PaymentRefundStatus.PROCESSING,
                PaymentRefundStatus.PROVIDER_PENDING,
                PaymentRefundStatus.FAILED_RETRYABLE,
              ],
            },
          },
          { failureCode: { in: [...CRITICAL_REFUND_FAILURES] } },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      include: {
        payment: {
          include: {
            order: { select: { code: true, status: true } },
            refunds: { select: { status: true, failureCode: true }, take: 1 },
          },
        },
      },
    }),
    prisma.payment.findMany({
      where: {
        provider: 'EDFAPAY',
        status: { in: [PaymentStatus.CAPTURED, PaymentStatus.HELD] },
        refunds: {
          none: { failureCode: { in: [...CRITICAL_REFUND_FAILURES] } },
        },
        order: { status: { in: [...REFUNDABLE_ORDER_STATUSES] } },
      },
      orderBy: { updatedAt: 'asc' },
      take: 10,
      include: {
        order: { select: { code: true, status: true } },
        refunds: { select: { status: true, failureCode: true }, take: 1 },
      },
    }),
    prisma.payment.findMany({
      where: {
        provider: 'EDFAPAY',
        status: PaymentStatus.PENDING,
        externalRef: null,
        providerOrderCode: { not: null },
        updatedAt: { lte: stalePaymentBefore },
      },
      orderBy: { updatedAt: 'asc' },
      take: 20,
      select: {
        id: true,
        amount: true,
        currency: true,
        providerOrderCode: true,
        updatedAt: true,
        order: { select: { code: true, status: true } },
      },
    }),
  ]);

  const criticalRefundPayments = criticalRefundOperations.map(
    (operation) => operation.payment,
  );
  const criticalPaymentIds = new Set(
    criticalRefundPayments.map((payment) => payment.id),
  );
  const refundablePayments = [
    ...criticalRefundPayments,
    ...ordinaryRefundablePayments.filter(
      (payment) => !criticalPaymentIds.has(payment.id),
    ),
  ];

  const countOf = (status: RFQStatus) =>
    statusGroups.find((group) => group.status === status)?._count ?? 0;
  const supplierCount = (status: SupplierStatus) =>
    supplierGroups.find((group) => group.status === status)?._count ?? 0;
  const shipmentCount = (status: string) =>
    shipments.find((group) => group.status === status)?._count ?? 0;

  const aiConfidence = aiQuality._avg.confidence ?? 0;
  const escrowValue = Number(escrowHold._sum.amount ?? 0);
  const supplierCounts = {
    approved: supplierCount(SupplierStatus.APPROVED),
    underReview: supplierCount(SupplierStatus.UNDER_REVIEW),
    pending: supplierCount(SupplierStatus.PENDING),
  };
  const shipmentCounts = {
    pending: shipmentCount('PENDING'),
    labelCreated: shipmentCount('LABEL_CREATED'),
    inTransit: shipmentCount('IN_TRANSIT'),
    delivered: shipmentCount('DELIVERED'),
  };

  return (
    <main className="ops-main">
      <CommandCenterSummary
        aiConfidence={aiConfidence}
        escrowValue={escrowValue}
        pipelineValues={{
          aiIntake:
            countOf(RFQStatus.FITMENT_REVIEW) +
            countOf(RFQStatus.NEED_MORE_INFO),
          sourcing:
            countOf(RFQStatus.SOURCING_LOCAL) +
            countOf(RFQStatus.SOURCING_GLOBAL),
          quoteReview: countOf(RFQStatus.QUOTES_READY) + draftOffers,
          payment: paymentCount,
          fulfillment:
            shipmentCounts.pending +
            shipmentCounts.labelCreated +
            shipmentCounts.inTransit,
        }}
        reviewCount={reviewCount}
        canReviewSuppliers={canReviewSuppliers}
        pendingSuppliersCount={pendingSuppliers.length}
        alertCount={disputeCount + complianceCount}
        revenueValue={Number(revenue._sum.totalAmount ?? 0)}
        aiDecisionCount={aiQuality._count.id}
        approvedSupplierCount={supplierCounts.approved}
        supplierReviewCount={
          supplierCounts.pending + supplierCounts.underReview
        }
        paymentCount={paymentCount}
      />

      <section className="ops-grid">
        <CommandCenterOperations
          rfqs={rfqs}
          aiRecent={aiRecent}
          aiConfidence={aiConfidence}
          canReviewSuppliers={canReviewSuppliers}
          pendingSuppliers={pendingSuppliers}
          supplierCounts={supplierCounts}
          escrowValue={escrowValue}
          paymentCount={paymentCount}
          disputeCount={disputeCount}
          complianceCount={complianceCount}
          shipmentCounts={shipmentCounts}
        />
        <CommandCenterFinance
          orders={orders}
          pendingPayouts={pendingPayouts}
          refundablePayments={refundablePayments}
          criticalRefundCount={criticalRefundOperations.length}
          stalePaymentIntakes={stalePaymentIntakes}
          canManagePayments={canManagePayments}
        />
      </section>
    </main>
  );
}
