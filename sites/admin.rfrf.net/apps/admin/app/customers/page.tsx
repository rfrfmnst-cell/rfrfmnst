import { Prisma, prisma } from '@rafraf/db';
import {
  ArrowLeft,
  ArrowRight,
  Clock3,
  Mail,
  MapPin,
  MessageCircleMore,
  Phone,
  ShieldCheck,
  UserRoundSearch,
} from 'lucide-react';
import Link from 'next/link';
import { requireAdminPermission } from '../../lib/require-admin-session';
import styles from './customers.module.css';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const FILTERS = ['ALL', 'ACTIVE', 'INACTIVE'] as const;

const DATE_TIME = new Intl.DateTimeFormat('ar-SA', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Riyadh',
});

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function customerPageHref(page: number, status: string): string {
  const params = new URLSearchParams();
  if (status !== 'ALL') params.set('status', status);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? '/customers?' + query : '/customers';
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string | string[];
    status?: string | string[];
  }>;
}) {
  await requireAdminPermission('OPERATIONS_READ');
  const resolved = await searchParams;
  const rawStatus = firstValue(resolved.status) ?? 'ALL';
  const normalizedStatus = (FILTERS as readonly string[]).includes(rawStatus)
    ? rawStatus
    : 'ALL';
  const parsedPage = Number.parseInt(firstValue(resolved.page) ?? '1', 10);
  const currentPage =
    Number.isSafeInteger(parsedPage) && parsedPage > 0
      ? Math.min(parsedPage, 10_000)
      : 1;

  const where: Prisma.CustomerWhereInput =
    normalizedStatus === 'ALL'
      ? {}
      : { user: { is: { isActive: normalizedStatus === 'ACTIVE' } } };

  const [customerRows, filteredTotal, total, active] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
      select: {
        id: true,
        fullName: true,
        city: true,
        user: {
          select: {
            phone: true,
            email: true,
            isActive: true,
            createdAt: true,
            lastLoginAt: true,
          },
        },
        _count: {
          select: {
            vehicles: true,
            addresses: true,
            rfqs: true,
            orders: true,
            disputes: true,
            chatThreads: true,
          },
        },
      },
    }),
    prisma.customer.count({ where }),
    prisma.customer.count(),
    prisma.customer.count({ where: { user: { is: { isActive: true } } } }),
  ]);

  const hasNextPage = customerRows.length > PAGE_SIZE;
  const customers = customerRows.slice(0, PAGE_SIZE);

  return (
    <main className={styles.page + ' rafraf-page-enter'}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <UserRoundSearch size={17} aria-hidden /> CUSTOMER 360
          </p>
          <h1>العملاء</h1>
          <span>
            هوية العميل ومساره التشغيلي في عرض واحد، دون أي بيانات اعتماد.
          </span>
        </div>
        <Link href="/" className={styles.back}>
          <ArrowLeft size={16} aria-hidden /> مركز العمليات
        </Link>
      </header>

      <section className={styles.summary} aria-label="ملخص العملاء">
        <article>
          <span>إجمالي العملاء</span>
          <strong>{total.toLocaleString('ar-SA')}</strong>
        </article>
        <article>
          <span>حسابات نشطة</span>
          <strong>{active.toLocaleString('ar-SA')}</strong>
        </article>
        <article>
          <span>حسابات غير نشطة</span>
          <strong>{(total - active).toLocaleString('ar-SA')}</strong>
        </article>
      </section>

      <form className={styles.filters} method="get">
        <label>
          <span>حالة الحساب</span>
          <select name="status" defaultValue={normalizedStatus}>
            <option value="ALL">الكل</option>
            <option value="ACTIVE">نشط</option>
            <option value="INACTIVE">غير نشط</option>
          </select>
        </label>
        <button type="submit">تطبيق</button>
      </form>

      <section className={styles.directory} aria-label="دليل العملاء">
        <div className={styles.directoryHead}>
          <h2>دليل العملاء</h2>
          <span>
            {customers.length.toLocaleString('ar-SA')} من{' '}
            {filteredTotal.toLocaleString('ar-SA')} · صفحة{' '}
            {currentPage.toLocaleString('ar-SA')}
          </span>
        </div>
        {customers.length === 0 ? (
          <div className={styles.empty}>
            <ShieldCheck size={30} aria-hidden />
            <strong>لا توجد نتائج في هذه الصفحة</strong>
            <span>ارجع إلى صفحة سابقة أو غيّر حالة الحساب.</span>
          </div>
        ) : (
          <div className={styles.rows + ' rafraf-motion-list'}>
            {customers.map((customer) => (
              <Link
                href={'/customers/' + customer.id}
                key={customer.id}
                className={styles.row + ' rafraf-motion-interactive'}
              >
                <span
                  className={
                    customer.user.isActive ? styles.active : styles.inactive
                  }
                >
                  {customer.user.isActive ? 'نشط' : 'غير نشط'}
                </span>
                <div className={styles.identity}>
                  <strong>{customer.fullName}</strong>
                  <small>
                    <MapPin size={14} aria-hidden />{' '}
                    {customer.city ?? 'مدينة غير مسجلة'}
                  </small>
                </div>
                <div className={styles.contact}>
                  <span dir="ltr">
                    <Phone size={14} aria-hidden /> {customer.user.phone}
                  </span>
                  <span dir="ltr">
                    <Mail size={14} aria-hidden />{' '}
                    {customer.user.email ?? 'لا يوجد بريد'}
                  </span>
                </div>
                <div className={styles.time}>
                  <span>
                    <Clock3 size={14} aria-hidden /> سُجل{' '}
                    {DATE_TIME.format(customer.user.createdAt)}
                  </span>
                  <small>
                    آخر دخول (بتوقيت الرياض):{' '}
                    {customer.user.lastLoginAt
                      ? DATE_TIME.format(customer.user.lastLoginAt)
                      : 'لم يسجل بعد'}
                  </small>
                </div>
                <div className={styles.counts}>
                  <span>{customer._count.vehicles} مركبة</span>
                  <span>{customer._count.addresses} عنوان</span>
                  <span>{customer._count.rfqs} تسعير</span>
                  <span>{customer._count.orders} طلب</span>
                  <span>{customer._count.disputes} نزاع</span>
                  <span>
                    <MessageCircleMore size={13} aria-hidden />{' '}
                    {customer._count.chatThreads}
                  </span>
                </div>
                <ArrowLeft size={18} aria-hidden />
              </Link>
            ))}
          </div>
        )}

        <nav className={styles.pagination} aria-label="صفحات دليل العملاء">
          {currentPage > 1 ? (
            <Link href={customerPageHref(currentPage - 1, normalizedStatus)}>
              <ArrowRight size={15} aria-hidden /> السابق
            </Link>
          ) : (
            <span aria-hidden />
          )}
          <strong>صفحة {currentPage.toLocaleString('ar-SA')}</strong>
          {hasNextPage ? (
            <Link href={customerPageHref(currentPage + 1, normalizedStatus)}>
              التالي <ArrowLeft size={15} aria-hidden />
            </Link>
          ) : (
            <span aria-hidden />
          )}
        </nav>
      </section>
    </main>
  );
}
