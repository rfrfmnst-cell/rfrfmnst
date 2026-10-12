import { prisma } from '@rafraf/db';
import {
  ArrowRight,
  CarFront,
  Clock3,
  FileSearch,
  KeyRound,
  Mail,
  MapPinned,
  MessageCircleMore,
  PackageCheck,
  Phone,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminPermission } from '../../../lib/require-admin-session';
import styles from '../customers.module.css';
import {
  CUSTOMER_ORDER_STATUS_AR,
  CUSTOMER_RFQ_STATUS_AR,
  formatCustomerMoney,
} from '../customer-status';

export const dynamic = 'force-dynamic';

const DATE_TIME = new Intl.DateTimeFormat('ar-SA', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Riyadh',
});

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminPermission('OPERATIONS_READ');
  const { id } = await params;

  const customer = await prisma.customer.findUnique({
    where: { id },
    select: {
      id: true,
      fullName: true,
      city: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          phone: true,
          email: true,
          isActive: true,
          createdAt: true,
          lastLoginAt: true,
        },
      },
      vehicles: {
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          make: true,
          model: true,
          year: true,
          engine: true,
          marketSpec: true,
          vin: true,
          plate: true,
          isDefault: true,
        },
      },
      addresses: {
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          label: true,
          city: true,
          district: true,
          street: true,
          buildingNumber: true,
          postalCode: true,
          additionalNumber: true,
          unitNumber: true,
          isDefault: true,
        },
      },
      rfqs: {
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: {
          id: true,
          code: true,
          status: true,
          createdAt: true,
          items: {
            take: 1,
            select: { freeTextAr: true, oemNumber: true },
          },
        },
      },
      orders: {
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: {
          id: true,
          code: true,
          status: true,
          totalAmount: true,
          currency: true,
          createdAt: true,
        },
      },
      disputes: {
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          status: true,
          reason: true,
          createdAt: true,
          order: { select: { code: true } },
        },
      },
      _count: { select: { chatThreads: true } },
    },
  });

  if (!customer) notFound();

  return (
    <main className={styles.detailPage + ' rafraf-page-enter'}>
      <Link href="/customers" className={styles.back}>
        <ArrowRight size={16} aria-hidden /> دليل العملاء
      </Link>

      <header className={styles.profileHero}>
        <div className={styles.avatar}>
          <UserRound size={28} aria-hidden />
        </div>
        <div>
          <p className={styles.kicker}>CUSTOMER 360</p>
          <h1>{customer.fullName}</h1>
          <span>{customer.city ?? 'المدينة غير مسجلة'}</span>
        </div>
        <span
          className={customer.user.isActive ? styles.active : styles.inactive}
        >
          {customer.user.isActive ? 'الحساب نشط' : 'الحساب غير نشط'}
        </span>
      </header>

      <section className={styles.factGrid} aria-label="بيانات العميل">
        <article>
          <Phone size={18} aria-hidden />
          <span>الجوال</span>
          <strong dir="ltr">{customer.user.phone}</strong>
        </article>
        <article>
          <Mail size={18} aria-hidden />
          <span>البريد</span>
          <strong dir="ltr">{customer.user.email ?? 'غير مسجل'}</strong>
        </article>
        <article>
          <Clock3 size={18} aria-hidden />
          <span>وقت التسجيل (بتوقيت الرياض)</span>
          <strong>{DATE_TIME.format(customer.user.createdAt)}</strong>
        </article>
        <article>
          <KeyRound size={18} aria-hidden />
          <span>آخر دخول (بتوقيت الرياض)</span>
          <strong>
            {customer.user.lastLoginAt
              ? DATE_TIME.format(customer.user.lastLoginAt)
              : 'لم يسجل بعد'}
          </strong>
        </article>
        <article>
          <MessageCircleMore size={18} aria-hidden />
          <span>المحادثات</span>
          <strong>{customer._count.chatThreads.toLocaleString('ar-SA')}</strong>
        </article>
        <article>
          <ShieldCheck size={18} aria-hidden />
          <span>طريقة الدخول</span>
          <strong>رمز OTP على الجوال</strong>
        </article>
      </section>

      <p className={styles.securityNote}>
        <ShieldCheck size={16} aria-hidden /> لا تُقرأ أو تُعرض كلمة المرور أو
        قيمة التجزئة في هذه الشاشة.
      </p>

      <div className={styles.detailGrid}>
        <section className={styles.detailPanel}>
          <header>
            <CarFront size={20} aria-hidden />
            <h2>المركبات</h2>
            <span>{customer.vehicles.length}</span>
          </header>
          {customer.vehicles.length ? (
            customer.vehicles.map((vehicle) => (
              <article key={vehicle.id} className={styles.detailRow}>
                <strong>
                  {vehicle.make} {vehicle.model} {vehicle.year}
                </strong>
                <span>
                  {vehicle.engine ?? 'محرك غير مسجل'} ·{' '}
                  {vehicle.marketSpec ?? 'مواصفة غير مسجلة'}
                </span>
                <small dir="ltr">
                  VIN: {vehicle.vin ?? '—'} · Plate: {vehicle.plate ?? '—'}
                </small>
                {vehicle.isDefault ? <b>افتراضية</b> : null}
              </article>
            ))
          ) : (
            <p className={styles.emptyInline}>لا توجد مركبات محفوظة.</p>
          )}
        </section>

        <section className={styles.detailPanel}>
          <header>
            <MapPinned size={20} aria-hidden />
            <h2>العناوين</h2>
            <span>{customer.addresses.length}</span>
          </header>
          {customer.addresses.length ? (
            customer.addresses.map((address) => (
              <article key={address.id} className={styles.detailRow}>
                <strong>
                  {address.label}
                  {address.isDefault ? ' · افتراضي' : ''}
                </strong>
                <span>
                  {address.city}، {address.district}، {address.street}
                </span>
                <small>
                  مبنى {address.buildingNumber} · رمز {address.postalCode}
                  {address.unitNumber ? ' · وحدة ' + address.unitNumber : ''}
                </small>
              </article>
            ))
          ) : (
            <p className={styles.emptyInline}>لا توجد عناوين محفوظة.</p>
          )}
        </section>

        <section className={styles.detailPanel}>
          <header>
            <FileSearch size={20} aria-hidden />
            <h2>طلبات التسعير</h2>
            <span>{customer.rfqs.length}</span>
          </header>
          {customer.rfqs.length ? (
            customer.rfqs.map((rfq) => (
              <Link
                href={'/rfq/' + rfq.id}
                key={rfq.id}
                className={styles.detailRow}
              >
                <strong>{rfq.items[0]?.freeTextAr ?? 'طلب تسعير'}</strong>
                <span dir="ltr">
                  {rfq.code} · {rfq.items[0]?.oemNumber ?? 'OEM —'}
                </span>
                <small>
                  {CUSTOMER_RFQ_STATUS_AR[rfq.status] ?? rfq.status} ·{' '}
                  {DATE_TIME.format(rfq.createdAt)}
                </small>
              </Link>
            ))
          ) : (
            <p className={styles.emptyInline}>لا توجد طلبات تسعير.</p>
          )}
        </section>

        <section className={styles.detailPanel}>
          <header>
            <PackageCheck size={20} aria-hidden />
            <h2>الطلبات</h2>
            <span>{customer.orders.length}</span>
          </header>
          {customer.orders.length ? (
            customer.orders.map((order) => (
              <article key={order.id} className={styles.detailRow}>
                <strong dir="ltr">{order.code}</strong>
                <span>
                  {CUSTOMER_ORDER_STATUS_AR[order.status] ?? order.status}
                </span>
                <small>
                  {formatCustomerMoney(order.totalAmount, order.currency)} ·{' '}
                  {DATE_TIME.format(order.createdAt)}
                </small>
              </article>
            ))
          ) : (
            <p className={styles.emptyInline}>لا توجد طلبات.</p>
          )}
        </section>
      </div>
    </main>
  );
}
