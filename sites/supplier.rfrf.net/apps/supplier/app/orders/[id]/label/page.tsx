import {
  OrderStatus,
  prisma,
  ShipmentStatus,
  SupplierStatus,
} from '@rafraf/db';
import { SUPPLIER_VISIBLE_ORDER_STATUSES } from '@rafraf/shared/workflow/supplier-order-visibility';
import {
  COMPLIANCE_PART_SELECT,
  ORDER_COMPLIANCE_SELECT,
  orderComplianceStatus,
} from '@rafraf/shared/workflow/order-compliance';
import { ArrowLeft, Clock3, Package, ShieldCheck, Truck } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getSessionSupplierId } from '../../../../lib/session';
import {
  ar,
  ORDER_STATUS_AR,
  SHIPMENT_STATUS_AR,
} from '../../../../lib/supplier-labels';
import { Code39Barcode } from './code39-barcode';
import { PrintLabelButton } from './print-button';
import { ShipmentConfirmation } from './shipment-confirmation';
import { CarrierRegistrationForm } from './carrier-registration-form';
import styles from './label.module.css';
import './label-print.css';

export const dynamic = 'force-dynamic';

const INTERNAL_EDITABLE_STATUSES: ShipmentStatus[] = [
  ShipmentStatus.PENDING,
  ShipmentStatus.LABEL_CREATED,
];

export default async function ShipmentLabelPage({
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
      select: { status: true },
    }),
    prisma.order.findFirst({
      where: {
        supplierId,
        status: { in: [...SUPPLIER_VISIBLE_ORDER_STATUSES] },
        OR: [{ id }, { code: id }],
      },
      include: {
        complianceCases: ORDER_COMPLIANCE_SELECT.complianceCases,
        shipments: { orderBy: { createdAt: 'desc' }, take: 1 },
        quote: {
          include: {
            part: { select: COMPLIANCE_PART_SELECT },
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
      },
    }),
  ]);

  if (!supplier || supplier.status !== SupplierStatus.APPROVED) redirect('/');
  if (!order) redirect('/shipments');

  const shipment = order.shipments[0];
  const complianceBlocked =
    order.status === OrderStatus.READY_TO_SHIP &&
    !orderComplianceStatus(order).cleared;
  // A persisted tracking reference remains printable after pickup, transit,
  // customs, delivery, return, or loss. Lifecycle progression must not hide it.
  const ready = Boolean(shipment?.trackingNumber);
  const internal =
    !shipment?.provider ||
    shipment.provider === 'MOCK' ||
    shipment.provider === 'RAFRAF_INTERNAL';
  const internalEditable =
    !shipment ||
    (internal && INTERNAL_EDITABLE_STATUSES.includes(shipment.status));
  const externalPending = Boolean(shipment && !internal && !ready);
  const internalBlocked = Boolean(
    shipment && internal && !internalEditable && !ready,
  );
  const canCreate =
    !complianceBlocked &&
    !ready &&
    order.status === OrderStatus.READY_TO_SHIP &&
    internalEditable;
  const canRegisterCarrier =
    !complianceBlocked &&
    order.status === OrderStatus.READY_TO_SHIP &&
    (!shipment ||
      (internal && INTERNAL_EDITABLE_STATUSES.includes(shipment.status)));
  const provider = internal ? 'مرجع رفرف الداخلي' : shipment?.provider;
  const previewState = complianceBlocked
    ? 'COMPLIANCE HOLD'
    : ready
      ? 'LABEL CREATED'
      : externalPending
        ? 'CARRIER PENDING'
        : internalBlocked
          ? 'STATE LOCKED'
          : 'PREVIEW';
  const barcodeValue =
    ready && !complianceBlocked && shipment?.trackingNumber
      ? shipment.trackingNumber
      : order.code;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>RAFRAF FULFILLMENT · PRODUCT OS V1.1</p>
          <h1>معاينة ملصق الشحن</h1>
          <p>
            راجع الطلب قبل الطباعة. هذه المعاينة لا تدّعي بوليصة ناقل خارجية ما
            لم يكن مزود الشحن قد أصدرها فعليًا.
          </p>
        </div>
        <a href="/shipments" className={styles.back}>
          <ArrowLeft size={16} aria-hidden /> العودة للتجهيز والشحن
        </a>
      </header>

      <div className={styles.layout}>
        <section className={styles.paper} aria-label="معاينة ملصق الشحن">
          <div className={styles.paperHead}>
            <strong>RAFRAF LOGISTICS</strong>
            <span
              className={
                ready && !complianceBlocked ? styles.ready : styles.preview
              }
            >
              {previewState}
            </span>
          </div>

          <h2 dir="ltr">{order.code}</h2>
          <Code39Barcode value={barcodeValue} className={styles.barcode} />
          <p className={styles.tracking} dir="ltr">
            {ready && !complianceBlocked
              ? shipment?.trackingNumber
              : `ORDER ${order.code}`}
          </p>

          <dl>
            <div>
              <dt>نوع المرجع</dt>
              <dd>{provider}</dd>
            </div>
            <div>
              <dt>محتوى الباركود</dt>
              <dd>
                {ready && !complianceBlocked
                  ? 'رقم التتبع'
                  : 'كود الطلب الداخلي'}
              </dd>
            </div>
            <div>
              <dt>حالة الطلب</dt>
              <dd>{ar(ORDER_STATUS_AR, order.status)}</dd>
            </div>
            <div>
              <dt>حالة الشحنة</dt>
              <dd>
                {ar(SHIPMENT_STATUS_AR, shipment?.status, 'لم تُنشأ بعد')}
              </dd>
            </div>
            <div>
              <dt>عدد الطرود</dt>
              <dd>1</dd>
            </div>
            <div>
              <dt>الكمية</dt>
              <dd>{order.quote.rfqItem.quantity}</dd>
            </div>
            <div>
              <dt>الوجهة</dt>
              <dd>عنوان العميل محفوظ لدى رفرف</dd>
            </div>
          </dl>

          <footer>
            <Package size={20} aria-hidden />
            <span>
              <b>{order.quote.rfqItem.freeTextAr ?? 'قطعة غيار'}</b>
              <small dir="ltr">
                OEM {order.quote.rfqItem.oemNumber ?? '—'}
              </small>
            </span>
          </footer>
        </section>

        <aside className={styles.actions} aria-labelledby="label-actions-title">
          <Truck size={30} aria-hidden />
          <h2 id="label-actions-title">
            {complianceBlocked
              ? 'بانتظار اعتماد الامتثال'
              : ready
                ? 'الملصق جاهز للطباعة'
                : externalPending
                  ? 'بانتظار مزود الشحن'
                  : internalBlocked
                    ? 'حالة الشحنة تمنع إعادة الإنشاء'
                    : canCreate
                      ? 'المعاينة جاهزة للإنشاء'
                      : 'بانتظار جاهزية الشحن'}
          </h2>
          <p>
            {complianceBlocked
              ? 'يلزم اعتماد مراجعة التصنيف والشهادات قبل إنشاء ملصق أو تسجيل ناقل. راجع فريق العمليات.'
              : ready
                ? internal
                  ? 'تم إنشاء مرجع رفرف داخلي. يبقى ملصق الناقل الفعلي خطوة منفصلة عند ربط مزود الشحن.'
                  : `تم إصدار بيانات الشحنة عبر ${shipment?.provider}.`
                : externalPending
                  ? `الشحنة مرتبطة بمزود ${shipment?.provider}. لن يولّد رفرف رقم تتبع بديلًا؛ ننتظر استجابة المزود الفعلية.`
                  : internalBlocked
                    ? `حالة الشحنة الحالية ${ar(SHIPMENT_STATUS_AR, shipment?.status)}. لا يعيد رفرف تحويل شحنة بدأت التنفيذ إلى مرحلة الملصق.`
                    : canCreate
                      ? 'أنشئ مرجع رفرف الداخلي بعد مراجعة الطلب. لا يتم إرسال أي بيانات لمزود خارجي من هذه الخطوة.'
                      : `حالة الطلب الحالية ${ar(ORDER_STATUS_AR, order.status)}. لا يسمح النظام بإنشاء ملصق قبل أن يصير الطلب «جاهزاً للشحن».`}
          </p>

          <div className={styles.guardrail}>
            <ShieldCheck size={20} aria-hidden />
            <span>
              <b>حماية بيانات العميل</b>
              <small>
                لا تعرض المعاينة اسم العميل أو جواله أو سعره النهائي. عنوان
                التسليم يبقى داخل طبقة التنفيذ.
              </small>
            </span>
          </div>

          {canCreate && (
            <ShipmentConfirmation
              orderId={order.id}
              routeId={id}
              orderCode={order.code}
              quantity={order.quote.rfqItem.quantity}
            />
          )}

          {canRegisterCarrier && (
            <CarrierRegistrationForm orderId={order.id} routeId={id} />
          )}

          {!ready && !canCreate && (
            <div className={styles.guardrail}>
              <Clock3 size={19} aria-hidden />
              <span>
                <b>
                  {externalPending
                    ? 'مزود خارجي مرتبط'
                    : internalBlocked
                      ? 'حالة الشحنة محمية'
                      : 'بوابة تنفيذ مفعلة'}
                </b>
                <small>
                  {externalPending
                    ? 'لا ننشئ tracking داخليًا فوق شحنة ناقل حقيقي.'
                    : internalBlocked
                      ? 'لا يمكن خفض حالة شحنة بدأت التنفيذ إلى مرحلة إنشاء الملصق.'
                      : 'أكمل تجهيز الطلب واعتماد الأدلة أولًا.'}
                </small>
              </span>
            </div>
          )}

          {ready && !complianceBlocked && (
            <PrintLabelButton className={styles.secondary ?? ''} />
          )}
          {!ready && (
            <small className={styles.note}>
              الباركود الحالي يمسح كود الطلب للمعاينة. الطباعة النهائية تتاح فقط
              بعد وجود ملصق أو رقم تتبع محفوظ فعليًا.
            </small>
          )}
        </aside>
      </div>
    </div>
  );
}
