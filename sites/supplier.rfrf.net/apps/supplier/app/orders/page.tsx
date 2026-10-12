import {
  OrderStatus,
  prisma,
  ShipmentStatus,
  SupplierStatus,
} from '@rafraf/db';
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  PackageCheck,
  Printer,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ar,
  ORDER_STATUS_AR,
  SHIPMENT_STATUS_AR,
} from '../../lib/supplier-labels';
import { getSessionSupplierId } from '../../lib/session';
import { SUPPLIER_VISIBLE_ORDER_STATUSES } from '@rafraf/shared/workflow/supplier-order-visibility';
import styles from './orders.module.css';

export const dynamic = 'force-dynamic';

const MOVING_STATUSES: OrderStatus[] = [
  OrderStatus.SHIPPED,
  OrderStatus.IN_TRANSIT,
  OrderStatus.CUSTOMS_REVIEW,
  OrderStatus.OUT_FOR_DELIVERY,
];
const DELIVERED_STATUSES: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.COMPLAINT_WINDOW,
  OrderStatus.CLOSED,
  OrderStatus.PAYOUT_RELEASED,
];

function money(value: number): string {
  return new Intl.NumberFormat('ar-SA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function canOpenLabel(
  status: OrderStatus,
  shipmentStatus?: ShipmentStatus,
  trackingNumber?: string | null,
): boolean {
  return (
    status === OrderStatus.READY_TO_SHIP ||
    Boolean(trackingNumber) ||
    shipmentStatus === ShipmentStatus.LABEL_CREATED
  );
}

export default async function SupplierOrdersPage() {
  const supplierId = await getSessionSupplierId();
  if (!supplierId) redirect('/login');

  const [supplier, orders, statusGroups, totalOrders] = await Promise.all([
    prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { businessName: true, city: true, status: true },
    }),
    prisma.order.findMany({
      where: {
        supplierId,
        status: { in: [...SUPPLIER_VISIBLE_ORDER_STATUSES] },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 50,
      include: {
        quote: {
          include: {
            landedCost: { select: { supplierPrice: true } },
            rfqItem: {
              select: {
                freeTextAr: true,
                oemNumber: true,
                quantity: true,
              },
            },
          },
        },
        shipments: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
        },
      },
    }),
    prisma.order.groupBy({
      by: ['status'],
      where: {
        supplierId,
        status: { in: [...SUPPLIER_VISIBLE_ORDER_STATUSES] },
      },
      _count: { _all: true },
    }),
    prisma.order.count({
      where: {
        supplierId,
        status: { in: [...SUPPLIER_VISIBLE_ORDER_STATUSES] },
      },
    }),
  ]);

  if (!supplier || supplier.status !== SupplierStatus.APPROVED) redirect('/');

  const countStatus = (status: OrderStatus) =>
    statusGroups.find((group) => group.status === status)?._count._all ?? 0;
  const awaitingDecisionCount = countStatus(
    OrderStatus.AWAITING_SUPPLIER_CONFIRMATION,
  );
  const readyCount = countStatus(OrderStatus.READY_TO_SHIP);
  const movingCount = MOVING_STATUSES.reduce(
    (sum, status) => sum + countStatus(status),
    0,
  );
  const deliveredCount = DELIVERED_STATUSES.reduce(
    (sum, status) => sum + countStatus(status),
    0,
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            RAFRAF SUPPLIER DECISIONS · PRODUCT OS V1.1
          </p>
          <h1>الطلبات وقرارات التنفيذ</h1>
          <p>
            طلبات {supplier.businessName}
            {supplier.city ? ` · ${supplier.city}` : ''} التي تنتظر قبولك أو
            رفضك، دون كشف بيانات العميل أو سعره النهائي. متابعة الشحنات الجارية
            في «تجهيز وشحن».
          </p>
        </div>
        <Link href="/" className={styles.back}>
          <ArrowLeft size={16} aria-hidden /> لوحة المورد
        </Link>
      </header>

      <section className={styles.metrics} aria-label="مؤشرات التجهيز والشحن">
        <article>
          <CheckCircle2 size={20} aria-hidden />
          <span>بانتظار قرارك</span>
          <strong>{awaitingDecisionCount}</strong>
          <small>طلبات مدفوعة تحتاج قبولًا أو رفضًا</small>
        </article>
        <article>
          <PackageCheck size={20} aria-hidden />
          <span>جاهز للشحن</span>
          <strong>{readyCount}</strong>
          <small>يمكن إنشاء مرجع الملصق</small>
        </article>
        <article>
          <Truck size={20} aria-hidden />
          <span>في التنفيذ</span>
          <strong>{movingCount}</strong>
          <small>شُحن أو في الطريق</small>
        </article>
        <article>
          <CheckCircle2 size={20} aria-hidden />
          <span>تم التسليم</span>
          <strong>{deliveredCount}</strong>
          <small>تسليم أو إغلاق أو تحرير مستحقات</small>
        </article>
      </section>

      <section className={styles.board}>
        <div className={styles.boardHead}>
          <div>
            <span>
              أحدث {Math.min(orders.length, 50)} من {totalOrders} طلبًا
            </span>
            <h2>طابور التنفيذ</h2>
          </div>
          <ShieldCheck size={23} aria-hidden />
        </div>

        {orders.length === 0 ? (
          <div className={styles.empty}>
            <PackageCheck size={30} aria-hidden />
            <h3>لا توجد طلبات تنفيذ حاليًا</h3>
            <p>ستظهر هنا الطلبات التي اختارها العملاء وربطت بمنشأتك.</p>
          </div>
        ) : (
          <div className={styles.list}>
            {orders.map((order) => {
              const shipment = order.shipments[0];
              const enabled = canOpenLabel(
                order.status,
                shipment?.status,
                shipment?.trackingNumber,
              );
              const supplierPrice = order.quote.landedCost?.supplierPrice;
              const needsDecision =
                order.status === OrderStatus.AWAITING_SUPPLIER_CONFIRMATION;
              return (
                <article key={order.id} className={styles.row}>
                  <div className={styles.identity}>
                    <span className={styles.code} dir="ltr">
                      {order.code}
                    </span>
                    <strong>
                      {order.quote.rfqItem.freeTextAr ?? 'قطعة غيار'}
                    </strong>
                    <small dir="ltr">
                      OEM {order.quote.rfqItem.oemNumber ?? '—'} · QTY{' '}
                      {order.quote.rfqItem.quantity}
                    </small>
                  </div>

                  <div className={styles.fact}>
                    <span>الحالة</span>
                    <strong>{ar(ORDER_STATUS_AR, order.status)}</strong>
                    <small>
                      {shipment
                        ? `${shipment.provider} · ${ar(SHIPMENT_STATUS_AR, shipment.status)}`
                        : 'لا توجد شحنة بعد'}
                    </small>
                  </div>

                  <div className={styles.fact}>
                    <span>سعر المورد المسجل</span>
                    <strong>
                      {supplierPrice == null
                        ? 'قيد التسوية'
                        : `${money(Number(supplierPrice))} ر.س`}
                    </strong>
                    <small>{order.updatedAt.toLocaleDateString('ar-SA')}</small>
                  </div>

                  <div className={styles.orderActions}>
                    <Link
                      className={
                        needsDecision ? styles.primary : styles.secondary
                      }
                      href={`/orders/${encodeURIComponent(order.code)}`}
                    >
                      <CheckCircle2 size={17} aria-hidden />
                      {needsDecision ? 'مراجعة وقبول' : 'تفاصيل الطلب'}
                    </Link>
                    {enabled ? (
                      <Link
                        className={styles.secondary}
                        href={`/orders/${encodeURIComponent(order.code)}/label`}
                      >
                        <Printer size={17} aria-hidden /> معاينة المرجع
                      </Link>
                    ) : (
                      <span
                        className={styles.locked}
                        aria-disabled="true"
                        title="رفرف تراجع مطابقة القطعة أولاً؛ يُفتح الملصق فور اعتماد المطابقة."
                      >
                        <Clock3 size={17} aria-hidden /> بانتظار الجاهزية
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <p className={styles.note}>
        <ShieldCheck size={17} aria-hidden /> صفحة المورد لا تعرض اسم العميل أو
        جواله أو عنوانه أو إجمالي العميل؛ بيانات العميل والسعر النهائي تبقى في
        طبقة التنفيذ المصرح بها.
      </p>
    </main>
  );
}
