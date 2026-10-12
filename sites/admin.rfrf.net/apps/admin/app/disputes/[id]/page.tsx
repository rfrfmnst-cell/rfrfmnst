import {
  DisputeStatus,
  EscrowEntryType,
  OrderStatus,
  PaymentStatus,
  prisma,
} from '@rafraf/db';
import { isSupplierRejectionDisputeReason } from '@rafraf/shared';
import { paymentRefundRoute } from '@rafraf/shared/payments/manual-payment-policy';
import { ArrowLeft, Banknote, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminPermission } from '../../../lib/require-admin-session';
import {
  refundDisputeClaim,
  rejectDisputeClaim,
  startDisputeReview,
} from '../actions';
import styles from '../disputes.module.css';
import {
  DISPUTE_STATUS_AR,
  ORDER_STATUS_AR,
  ar,
  disputeReasonLabel,
} from '../../../lib/admin-labels';

export const dynamic = 'force-dynamic';

const RESULT_AR: Record<string, string> = {
  reviewing: 'بدأت المراجعة وثُبّت الإسناد.',
  released: 'رُفضت الشكوى وسُوّي الضمان لصالح المورد.',
  completed: 'اكتمل رد الدفعة وأُغلقت الشكوى.',
  resolved: 'أُصلح سجل الشكوى وربط بالاسترداد المكتمل.',
  replayed: 'القرار مسجل مسبقًا؛ لم يُكرر أي أثر مالي.',
  provider_pending: 'الاسترداد قيد التحقق مع مزود الدفع.',
  invalid_note: 'اكتب ملخص قرار واضحًا من 10 أحرف على الأقل.',
  invalid_refund: 'ملخص القرار وتأكيد كود الطلب مطلوبان.',
  refund_not_ready: 'لا توجد دفعة محتجزة مؤهلة أو إعداد المزود غير جاهز.',
  manual_refund_unavailable:
    'الدفع يدوي؛ مسار رد موثق للتحويل البنكي غير معتمد بعد.',
  multiple_active: 'يوجد أكثر من نزاع نشط للطلب؛ يلزم توحيدها قبل أي أثر مالي.',
  not_actionable: 'تغيرت حالة الطلب؛ لم يُنفذ أي أثر مالي.',
};

export default async function DisputeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ result?: string }>;
}) {
  const admin = await requireAdminPermission('OPERATIONS_READ');
  const { id } = await params;
  const { result } = await searchParams;
  const dispute = await prisma.dispute.findUnique({
    where: { id },
    include: {
      customer: { include: { user: { select: { phone: true, email: true } } } },
      order: {
        include: {
          supplier: { select: { businessName: true, contactPhone: true } },
          escrow: {
            where: { entryType: EscrowEntryType.HOLD },
            orderBy: { createdAt: 'asc' },
            take: 2,
            select: {
              paymentId: true,
              payment: {
                select: { id: true, status: true, provider: true },
              },
            },
          },
        },
      },
    },
  });
  if (!dispute) notFound();

  const canWrite = admin.permissions.includes('PAYMENT_WRITE');
  const active =
    dispute.status === DisputeStatus.OPEN ||
    dispute.status === DisputeStatus.UNDER_REVIEW;
  const supplierRejected = isSupplierRejectionDisputeReason(dispute.reason);
  const canonicalPayment =
    dispute.order.escrow.length === 1 ? dispute.order.escrow[0]?.payment : null;
  const refundRoute = paymentRefundRoute(canonicalPayment?.provider);
  const edfaPayRefundable =
    refundRoute.allowed &&
    (dispute.order.status === OrderStatus.REFUNDED
      ? canonicalPayment?.status === PaymentStatus.REFUNDED
      : canonicalPayment?.status === PaymentStatus.CAPTURED ||
        canonicalPayment?.status === PaymentStatus.HELD);
  const manualPayment =
    !refundRoute.allowed &&
    refundRoute.reason === 'manual_payment_refund_workflow_not_implemented';

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>DISPUTE · {dispute.id.slice(-8).toUpperCase()}</p>
          <h1>مراجعة النزاع</h1>
          <span>
            الطلب {dispute.order.code} · {ar(DISPUTE_STATUS_AR, dispute.status)}
          </span>
        </div>
        <Link href="/disputes">
          <ArrowLeft size={16} aria-hidden /> الطابور
        </Link>
      </header>

      {result ? (
        <p className={styles.notice} role="status">
          {RESULT_AR[result] ?? result}
        </p>
      ) : null}

      <div className={styles.detailGrid}>
        <section className={styles.panel}>
          <h2>ملف الشكوى</h2>
          <div className={styles.facts}>
            <div>
              <span>العميل</span>
              <strong>{dispute.customer.fullName}</strong>
            </div>
            <div>
              <span>الجوال</span>
              <bdi dir="ltr">{dispute.customer.user.phone}</bdi>
            </div>
            <div>
              <span>المورد</span>
              <strong>{dispute.order.supplier?.businessName ?? '—'}</strong>
            </div>
            <div>
              <span>حالة الطلب</span>
              <strong>{ar(ORDER_STATUS_AR, dispute.order.status)}</strong>
            </div>
            <div>
              <span>السبب</span>
              <strong>{disputeReasonLabel(dispute.reason)}</strong>
            </div>
            <div>
              <span>تاريخ الفتح</span>
              <strong>{dispute.createdAt.toLocaleString('ar-SA')}</strong>
            </div>
          </div>
          <p className={styles.description}>
            {dispute.description ?? 'لا يوجد وصف إضافي.'}
          </p>
          {dispute.resolutionNote ? (
            <p>
              <strong>قرار المراجعة:</strong> {dispute.resolutionNote}
            </p>
          ) : null}
        </section>

        <aside className={`${styles.panel} ${styles.actions}`}>
          <h2>
            <ShieldAlert size={19} aria-hidden /> قرار العمليات
          </h2>
          {!canWrite ? (
            <p className={styles.muted}>العرض فقط؛ يلزم PAYMENT_WRITE للحسم.</p>
          ) : null}

          {canWrite && dispute.status === DisputeStatus.OPEN ? (
            <form action={startDisputeReview}>
              <input type="hidden" name="disputeId" value={dispute.id} />
              <button type="submit" className={styles.reviewButton}>
                بدء المراجعة
              </button>
            </form>
          ) : null}

          {canWrite && active && edfaPayRefundable ? (
            <form action={refundDisputeClaim} className={styles.form}>
              <h3>
                <Banknote size={17} aria-hidden /> قبول الشكوى ورد الدفعة
              </h3>
              <input type="hidden" name="disputeId" value={dispute.id} />
              <label>
                ملخص القرار
                <textarea
                  name="resolutionNote"
                  minLength={10}
                  maxLength={500}
                  required
                />
              </label>
              <label>
                اكتب كود الطلب للتأكيد
                <input name="confirmOrderCode" autoComplete="off" required />
              </label>
              <button type="submit">رد الدفعة وإغلاق النزاع</button>
            </form>
          ) : null}

          {active && manualPayment ? (
            <p className={styles.muted} role="status">
              هذه الدفعة تحويل بنكي يدوي. لا يمكن قبول الشكوى أو إرسالها إلى
              EdfaPay. أوقف الصرف، ولا تغيّر الحالة المالية حتى يُعتمد workflow
              موثق لرد التحويلات.
            </p>
          ) : null}

          {supplierRejected && active && edfaPayRefundable ? (
            <p className={styles.muted}>
              المورد هو من تعذّر عليه التنفيذ؛ لا يسمح هذا النزاع بالإفراج له،
              والمسار المالي المتاح هو رد الدفعة للعميل.
            </p>
          ) : null}

          {canWrite && active && !supplierRejected ? (
            <form
              action={rejectDisputeClaim}
              className={`${styles.form} ${styles.danger}`}
            >
              <h3>رفض الشكوى والإفراج للمورد</h3>
              <input type="hidden" name="disputeId" value={dispute.id} />
              <label>
                حيثيات القرار
                <textarea
                  name="resolutionNote"
                  minLength={10}
                  maxLength={500}
                  required
                />
              </label>
              <button type="submit">رفض الشكوى وتسوية الضمان</button>
            </form>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
