import { OrderStatus, prisma, SupplierStatus } from '@rafraf/db';
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  PackageCheck,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ar, ORDER_STATUS_AR } from '../../../lib/supplier-labels';
import { getSessionSupplierId } from '../../../lib/session';
import { SUPPLIER_REJECTION_REASONS } from '../../../lib/supplier-order-confirmation';
import { SubmitButton } from '@rafraf/ui/submit-button';
import {
  nextSupplierFulfilmentStep,
  type SupplierFulfilmentStep,
} from '../../../lib/supplier-fulfilment';
import { carrierShipmentSupportsOrderStep } from '@rafraf/shared/workflow/shipment-proof';
import {
  COMPLIANCE_PART_SELECT,
  ORDER_COMPLIANCE_SELECT,
  orderComplianceStatus,
} from '@rafraf/shared/workflow/order-compliance';
import { SUPPLIER_VISIBLE_ORDER_STATUSES } from '@rafraf/shared/workflow/supplier-order-visibility';
import {
  acceptSupplierOrder,
  advanceSupplierOrderFulfilment,
  rejectSupplierOrder,
} from './actions';

/**
 * نصّ الزرّ لكل خطوة. الخطوة المعروضة تأتي من `nextSupplierFulfilmentStep`
 * وحدها، فلا يمكن للواجهة أن تعرض خطوة يرفضها مسار الكتابة.
 */
const FULFILMENT_STEP_AR: Record<
  SupplierFulfilmentStep,
  { cta: string; pending: string; hint: string }
> = {
  READY_TO_SHIP: {
    cta: 'التجهيز مكتمل — جاهز للشحن',
    pending: 'جارٍ تسجيل الجاهزية…',
    hint: 'اعتمدت العمليات توافق القطعة. سجّل جاهزية الشحن بعد التجهيز الفعلي.',
  },
  SHIPPED: {
    cta: 'مزامنة استلام شركة الشحن',
    pending: 'جارٍ التحقق من الناقل…',
    hint: 'تُفتح الخطوة بعد أن يؤكد مزود الشحن الخارجي استلام الشحنة.',
  },
  IN_TRANSIT: {
    cta: 'مزامنة حالة الطريق',
    pending: 'جارٍ التحقق من الناقل…',
    hint: 'الحالة تأتي من مزود الشحن ولا تُقبل كإقرار يدوي من المورد.',
  },
  OUT_FOR_DELIVERY: {
    cta: 'مزامنة الخروج للتسليم',
    pending: 'جارٍ التحقق من الناقل…',
    hint: 'تظهر بعد وصول تأكيد الخروج للتسليم من الناقل.',
  },
  DELIVERED: {
    cta: 'مزامنة إثبات التسليم',
    pending: 'جارٍ التحقق من إثبات الناقل…',
    hint: 'لا تبدأ نافذة الشكوى إلا بعد إثبات DELIVERED من ناقل خارجي.',
  },
};
import styles from './order.module.css';

export const dynamic = 'force-dynamic';

function money(value: number): string {
  return new Intl.NumberFormat('ar-SA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

export default async function SupplierOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supplierId = await getSessionSupplierId();
  if (!supplierId) redirect('/login');

  const { id } = await params;
  const [supplier, order] = await Promise.all([
    prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { businessName: true, status: true },
    }),
    prisma.order.findFirst({
      where: {
        supplierId,
        status: { in: [...SUPPLIER_VISIBLE_ORDER_STATUSES] },
        OR: [{ id }, { code: id }],
      },
      select: {
        id: true,
        code: true,
        status: true,
        currency: true,
        createdAt: true,
        updatedAt: true,
        complianceCases: ORDER_COMPLIANCE_SELECT.complianceCases,
        quote: {
          select: {
            deliveryDaysMin: true,
            deliveryDaysMax: true,
            warrantyMonths: true,
            part: { select: COMPLIANCE_PART_SELECT },
            landedCost: { select: { supplierPrice: true } },
            rfqItem: {
              select: {
                freeTextAr: true,
                oemNumber: true,
                quantity: true,
                part: { select: COMPLIANCE_PART_SELECT },
              },
            },
          },
        },
        events: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 12,
          select: {
            id: true,
            fromStatus: true,
            toStatus: true,
            createdAt: true,
          },
        },
        shipments: {
          orderBy: { updatedAt: 'desc' },
          take: 5,
          select: { provider: true, trackingNumber: true, status: true },
        },
      },
    }),
  ]);

  if (!supplier || supplier.status !== SupplierStatus.APPROVED) redirect('/');
  if (!order) redirect('/orders');

  const canDecide = order.status === OrderStatus.AWAITING_SUPPLIER_CONFIRMATION;
  const accepted = order.status === OrderStatus.SUPPLIER_ACCEPTED;
  const rejected = order.status === OrderStatus.DISPUTED;
  const nextStep = nextSupplierFulfilmentStep(order.status);
  const complianceCleared =
    !['READY_TO_SHIP', 'SHIPPED'].includes(nextStep ?? '') ||
    orderComplianceStatus(order).cleared;
  const carrierConfirmed =
    !nextStep ||
    nextStep === 'READY_TO_SHIP' ||
    order.shipments.some((shipment) =>
      carrierShipmentSupportsOrderStep(nextStep, shipment),
    );
  const supplierPrice = order.quote.landedCost?.supplierPrice;
  const deliveryRange =
    order.quote.deliveryDaysMin == null && order.quote.deliveryDaysMax == null
      ? 'غير محددة'
      : `${order.quote.deliveryDaysMin ?? '—'}–${order.quote.deliveryDaysMax ?? '—'} يوم`;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            RAFRAF SUPPLIER CONFIRMATION · PRODUCT OS V1.1
          </p>
          <h1>تفاصيل الطلب وقرار التنفيذ</h1>
          <p>
            راجع القطعة والسعر التشغيلي ومدة التوريد قبل الالتزام. بيانات العميل
            وسعره النهائي لا تظهر في بوابة المورد.
          </p>
        </div>
        <Link href="/orders" className={styles.back}>
          <ArrowLeft size={16} aria-hidden /> العودة للطلبات
        </Link>
      </header>

      <div className={styles.layout}>
        <section className={styles.summary} aria-labelledby="order-title">
          <div className={styles.summaryHead}>
            <div>
              <span className={styles.code} dir="ltr">
                {order.code}
              </span>
              <h2 id="order-title">
                {order.quote.rfqItem.freeTextAr ?? 'قطعة غيار'}
              </h2>
            </div>
            <span className={styles.status}>
              {ar(ORDER_STATUS_AR, order.status)}
            </span>
          </div>

          <dl className={styles.facts}>
            <div>
              <dt>رقم OEM</dt>
              <dd dir="ltr">{order.quote.rfqItem.oemNumber ?? '—'}</dd>
            </div>
            <div>
              <dt>الكمية</dt>
              <dd>{order.quote.rfqItem.quantity}</dd>
            </div>
            <div>
              <dt>سعر المورد المسجل</dt>
              <dd>
                {supplierPrice == null
                  ? 'قيد التسوية'
                  : `${money(Number(supplierPrice))} ${order.currency}`}
              </dd>
            </div>
            <div>
              <dt>مدة التوريد</dt>
              <dd>{deliveryRange}</dd>
            </div>
            <div>
              <dt>الضمان</dt>
              <dd>{order.quote.warrantyMonths} شهر</dd>
            </div>
            <div>
              <dt>آخر تحديث</dt>
              <dd>{order.updatedAt.toLocaleString('ar-SA')}</dd>
            </div>
          </dl>

          <div className={styles.privacy}>
            <ShieldCheck size={20} aria-hidden />
            <span>
              <b>عزل بيانات التنفيذ</b>
              <small>
                لا تعرض هذه الصفحة اسم العميل أو جواله أو عنوانه أو إجمالي ما
                دفعه.
              </small>
            </span>
          </div>
        </section>

        <aside className={styles.decision} aria-labelledby="decision-title">
          {canDecide ? (
            <>
              <PackageCheck size={30} aria-hidden />
              <h2 id="decision-title">هل تستطيع تنفيذ الطلب؟</h2>
              <p>
                القبول التزام بالتجهيز وفق العرض. الرفض يحوّل الطلب إلى العمليات
                ويبقي المبلغ محتجزًا؛ لا يحدث استرداد تلقائي.
              </p>

              <form action={acceptSupplierOrder} className={styles.acceptForm}>
                <input type="hidden" name="orderId" value={order.id} />
                <input type="hidden" name="routeId" value={id} />
                <SubmitButton
                  pendingLabel="جارٍ تثبيت القبول…"
                  className={styles.accept}
                >
                  <CheckCircle2 size={18} aria-hidden /> قبول وتنفيذ الطلب
                </SubmitButton>
              </form>

              <form action={rejectSupplierOrder} className={styles.rejectForm}>
                <input type="hidden" name="orderId" value={order.id} />
                <input type="hidden" name="routeId" value={id} />
                <label htmlFor="reasonCode">سبب تعذر التنفيذ</label>
                <select
                  id="reasonCode"
                  name="reasonCode"
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    اختر سببًا
                  </option>
                  {Object.entries(SUPPLIER_REJECTION_REASONS).map(
                    ([code, label]) => (
                      <option key={code} value={code}>
                        {label}
                      </option>
                    ),
                  )}
                </select>
                <SubmitButton
                  pendingLabel="جارٍ إرسال الرفض…"
                  className={styles.reject}
                >
                  <XCircle size={18} aria-hidden /> تعذر التنفيذ
                </SubmitButton>
              </form>
            </>
          ) : (
            <>
              {accepted ? (
                <CheckCircle2 size={32} aria-hidden />
              ) : rejected ? (
                <ShieldAlert size={32} aria-hidden />
              ) : (
                <Clock3 size={32} aria-hidden />
              )}
              <h2 id="decision-title">
                {accepted
                  ? 'تم قبول الطلب'
                  : rejected
                    ? 'الطلب لدى العمليات'
                    : nextStep
                      ? 'الخطوة التالية في التنفيذ'
                      : 'القرار مغلق في هذه المرحلة'}
              </h2>
              <p>
                {accepted
                  ? 'بانتظار اعتماد العمليات لتوافق القطعة قبل فتح مسار الشحن.'
                  : rejected
                    ? 'بقي المبلغ محتجزًا ولم ينفذ النظام أي استرداد تلقائي.'
                    : nextStep
                      ? FULFILMENT_STEP_AR[nextStep].hint
                      : `حالة الطلب الحالية ${ar(ORDER_STATUS_AR, order.status)}.`}
              </p>

              {nextStep && !complianceCleared ? (
                <p role="status">
                  بانتظار مراجعة واعتماد الامتثال من فريق رفرف قبل الشحن.
                </p>
              ) : null}
              {nextStep && carrierConfirmed && complianceCleared ? (
                <form
                  action={advanceSupplierOrderFulfilment}
                  className={styles.acceptForm}
                >
                  <input type="hidden" name="orderId" value={order.id} />
                  <input type="hidden" name="routeId" value={id} />
                  <input type="hidden" name="step" value={nextStep} />
                  <SubmitButton
                    pendingLabel={FULFILMENT_STEP_AR[nextStep].pending}
                    className={styles.accept}
                  >
                    <PackageCheck size={18} aria-hidden />{' '}
                    {FULFILMENT_STEP_AR[nextStep].cta}
                  </SubmitButton>
                </form>
              ) : null}
              {nextStep && !carrierConfirmed ? (
                <div className={styles.privacy} role="status">
                  <ShieldCheck size={20} aria-hidden />
                  <span>
                    <b>بانتظار تأكيد الناقل</b>
                    <small>
                      مرجع رفرف الداخلي للمعاينة فقط. لا يمكنه إثبات الشحن أو
                      التسليم أو فتح مسار صرف المستحقات.
                    </small>
                  </span>
                </div>
              ) : null}
            </>
          )}
        </aside>
      </div>

      <section className={styles.timeline} aria-labelledby="timeline-title">
        <div className={styles.timelineHead}>
          <div>
            <span>سجل غير قابل للتعديل</span>
            <h2 id="timeline-title">حركة حالة الطلب</h2>
          </div>
          <ShieldCheck size={22} aria-hidden />
        </div>
        <ol>
          {order.events.map((event) => (
            <li key={event.id}>
              <span>{event.createdAt.toLocaleString('ar-SA')}</span>
              <strong>
                {event.fromStatus
                  ? `${ar(ORDER_STATUS_AR, event.fromStatus)} ← `
                  : ''}
                {ar(ORDER_STATUS_AR, event.toStatus)}
              </strong>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
