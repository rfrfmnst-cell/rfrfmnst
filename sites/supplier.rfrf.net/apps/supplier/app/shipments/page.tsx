import { OrderStatus, Prisma, prisma, SupplierStatus } from '@rafraf/db';
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
import { ar, ORDER_STATUS_AR } from '../../lib/supplier-labels';
import { getSessionSupplierId } from '../../lib/session';
import styles from './shipments.module.css';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

const ACTIVE_STATUSES: OrderStatus[] = [
  OrderStatus.AWAITING_SUPPLIER_CONFIRMATION,
  OrderStatus.SUPPLIER_ACCEPTED,
  OrderStatus.FITMENT_VERIFIED,
  OrderStatus.READY_TO_SHIP,
  OrderStatus.SHIPPED,
  OrderStatus.IN_TRANSIT,
  OrderStatus.CUSTOMS_REVIEW,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERED,
  OrderStatus.COMPLAINT_WINDOW,
];
const WAITING_STATUSES: OrderStatus[] = [
  OrderStatus.AWAITING_SUPPLIER_CONFIRMATION,
  OrderStatus.SUPPLIER_ACCEPTED,
  OrderStatus.FITMENT_VERIFIED,
];
const MOVING_STATUSES: OrderStatus[] = [
  OrderStatus.SHIPPED,
  OrderStatus.IN_TRANSIT,
  OrderStatus.CUSTOMS_REVIEW,
  OrderStatus.OUT_FOR_DELIVERY,
];

function parsePage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export default async function SupplierShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const supplierId = await getSessionSupplierId();
  if (!supplierId) redirect('/login');

  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { status: true },
  });
  if (!supplier || supplier.status !== SupplierStatus.APPROVED) redirect('/');

  const { page: requestedPageValue } = await searchParams;
  const orderWhere: Prisma.OrderWhereInput = {
    supplierId,
    status: { in: ACTIVE_STATUSES },
  };
  const [totalOrders, statusGroups] = await Promise.all([
    prisma.order.count({ where: orderWhere }),
    prisma.order.groupBy({
      by: ['status'],
      where: orderWhere,
      _count: { _all: true },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalOrders / PAGE_SIZE));
  const currentPage = Math.min(parsePage(requestedPageValue), totalPages);
  const orders = await prisma.order.findMany({
    // Keep tenant scope explicit at the read boundary; do not rely on a shared
    // filter variable for the final supplier-facing payload.
    where: {
      supplierId,
      status: { in: ACTIVE_STATUSES },
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    skip: (currentPage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: {
      quote: {
        include: {
          rfqItem: {
            select: { freeTextAr: true, oemNumber: true, quantity: true },
          },
        },
      },
      shipments: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  const countStatus = (status: OrderStatus) =>
    statusGroups.find((group) => group.status === status)?._count._all ?? 0;
  const ready = countStatus(OrderStatus.READY_TO_SHIP);
  const moving = MOVING_STATUSES.reduce(
    (sum, status) => sum + countStatus(status),
    0,
  );
  const waiting = WAITING_STATUSES.reduce(
    (sum, status) => sum + countStatus(status),
    0,
  );
  const firstResult = totalOrders === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const lastResult = Math.min(currentPage * PAGE_SIZE, totalOrders);
  const pageWindowStart = Math.min(
    Math.max(1, currentPage - 2),
    Math.max(1, totalPages - 4),
  );
  const pageNumbers = Array.from(
    { length: Math.min(5, totalPages) },
    (_, index) => pageWindowStart + index,
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>RAFRAF FULFILLMENT · PRODUCT OS V1.1</p>
          <h1>التجهيز والشحن</h1>
          <span>
            الشحنات الجارية لمنشأتك، من التجهيز إلى التسليم. قرارات القبول
            والرفض في «الطلبات».
          </span>
        </div>
        <Link href="/">
          <ArrowLeft size={16} aria-hidden /> لوحة المورد
        </Link>
      </header>

      <section className={styles.metrics} aria-label="مؤشرات طابور الشحن">
        <article>
          <span>قيد التجهيز</span>
          <strong>{waiting}</strong>
          <small>قبل بوابة الشحن</small>
        </article>
        <article className={styles.ready}>
          <span>جاهز للشحن</span>
          <strong>{ready}</strong>
          <small>يمكن إنشاء ملصق</small>
        </article>
        <article className={styles.moving}>
          <span>في التنفيذ</span>
          <strong>{moving}</strong>
          <small>شُحن أو في الطريق أو الجمارك</small>
        </article>
      </section>

      <section className={styles.guardrail} aria-label="ضوابط بوابة الشحن">
        <ShieldCheck size={20} aria-hidden />
        <span>
          <b>بوابة شحن محكومة</b>
          <small>
            لا يُنشأ مرجع ملصق جديد قبل أن يصير الطلب «جاهزاً للشحن»، ولا تعرض
            هذه الصفحة بيانات العميل الحساسة. حالات الجمارك تبقى ظاهرة للمورد
            ولا تُعامل كتوقف مجهول.
          </small>
        </span>
      </section>

      <div className={styles.pageMeta} role="status">
        <span>
          عرض {firstResult.toLocaleString('ar-SA')}–
          {lastResult.toLocaleString('ar-SA')} من{' '}
          {totalOrders.toLocaleString('ar-SA')} طلب نشط
        </span>
        <small>
          صفحة {currentPage.toLocaleString('ar-SA')} من{' '}
          {totalPages.toLocaleString('ar-SA')}
        </small>
      </div>

      <section className={styles.queue} aria-label="طلبات التنفيذ النشطة">
        {orders.length === 0 ? (
          <div className={styles.empty}>
            <PackageCheck size={28} aria-hidden />
            <b>لا توجد طلبات تنفيذ نشطة</b>
            <span>ستظهر هنا الطلبات بعد اعتماد العميل وانتقالها للمورد.</span>
          </div>
        ) : (
          orders.map((order) => {
            const shipment = order.shipments[0];
            const hasSavedLabel = Boolean(shipment?.trackingNumber);
            const canPreview =
              order.status === OrderStatus.READY_TO_SHIP || hasSavedLabel;
            return (
              <article className={styles.row} key={order.id}>
                <div className={styles.identity}>
                  <code dir="ltr">{order.code}</code>
                  <strong>
                    {order.quote.rfqItem.freeTextAr ?? 'قطعة غيار'}
                  </strong>
                  <small dir="ltr">
                    OEM {order.quote.rfqItem.oemNumber ?? '—'} · QTY{' '}
                    {order.quote.rfqItem.quantity}
                  </small>
                </div>
                <div className={styles.state}>
                  {order.status === OrderStatus.READY_TO_SHIP ? (
                    <CheckCircle2 size={18} aria-hidden />
                  ) : MOVING_STATUSES.includes(order.status) ? (
                    <Truck size={18} aria-hidden />
                  ) : (
                    <Clock3 size={18} aria-hidden />
                  )}
                  <span>
                    <b>{ar(ORDER_STATUS_AR, order.status)}</b>
                    <small>
                      {shipment?.trackingNumber ? (
                        <bdi dir="ltr">Tracking {shipment.trackingNumber}</bdi>
                      ) : (
                        'لا يوجد رقم تتبع بعد'
                      )}
                    </small>
                  </span>
                </div>
                <div className={styles.actions}>
                  {canPreview ? (
                    <a
                      className={styles.primary}
                      href={`/orders/${order.code}/label`}
                    >
                      <Printer size={17} aria-hidden /> معاينة الملصق
                    </a>
                  ) : (
                    <span
                      className={styles.locked}
                      title={
                        order.status === OrderStatus.CUSTOMS_REVIEW
                          ? 'الشحنة لدى الجمارك؛ لا إجراء مطلوب منك الآن.'
                          : 'رفرف تراجع مطابقة القطعة أولاً؛ يُفتح الملصق فور اعتماد المطابقة.'
                      }
                    >
                      {order.status === OrderStatus.CUSTOMS_REVIEW
                        ? 'قيد المراجعة الجمركية'
                        : 'بانتظار الجاهزية'}
                    </span>
                  )}
                </div>
              </article>
            );
          })
        )}
      </section>

      {totalPages > 1 && (
        <nav className={styles.pagination} aria-label="صفحات طابور الشحن">
          {currentPage > 1 ? (
            <a href={`/shipments?page=${currentPage - 1}`}>السابق</a>
          ) : (
            <span aria-disabled="true">السابق</span>
          )}
          <div>
            {pageNumbers.map((pageNumber) =>
              pageNumber === currentPage ? (
                <span
                  key={pageNumber}
                  className={styles.currentPage}
                  aria-current="page"
                >
                  {pageNumber.toLocaleString('ar-SA')}
                </span>
              ) : (
                <a key={pageNumber} href={`/shipments?page=${pageNumber}`}>
                  {pageNumber.toLocaleString('ar-SA')}
                </a>
              ),
            )}
          </div>
          {currentPage < totalPages ? (
            <a href={`/shipments?page=${currentPage + 1}`}>التالي</a>
          ) : (
            <span aria-disabled="true">التالي</span>
          )}
        </nav>
      )}
    </div>
  );
}
