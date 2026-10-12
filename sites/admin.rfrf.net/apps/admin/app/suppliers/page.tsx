import { Prisma, prisma, SupplierStatus } from '@rafraf/db';
import {
  ArrowLeft,
  Building2,
  FileCheck2,
  Search,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import Link from 'next/link';
import { requireAdminPermission } from '../../lib/require-admin-session';
import styles from './suppliers.module.css';

export const dynamic = 'force-dynamic';

const OPEN_STATUSES: SupplierStatus[] = [
  SupplierStatus.PENDING,
  SupplierStatus.UNDER_REVIEW,
];

const STATUS_AR: Record<SupplierStatus, string> = {
  PENDING: 'بانتظار المراجعة',
  UNDER_REVIEW: 'تحت المراجعة',
  APPROVED: 'معتمد',
  LIMITED: 'معتمد بقيود',
  SUSPENDED: 'موقوف',
  REJECTED: 'مرفوض',
};

const FILTERS = ['OPEN', ...Object.values(SupplierStatus)] as const;

function relativeDate(date: Date): string {
  const days = Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000)),
  );
  if (days === 0) return 'اليوم';
  if (days === 1) return 'أمس';
  return `منذ ${days.toLocaleString('ar-SA')} أيام`;
}

export default async function SuppliersQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; error?: string }>;
}) {
  await requireAdminPermission('SUPPLIER_WRITE');
  const { q = '', status = 'OPEN', error } = await searchParams;
  const query = q.trim().slice(0, 120);
  const normalizedStatus = (FILTERS as readonly string[]).includes(status)
    ? status
    : 'OPEN';

  const where: Prisma.SupplierWhereInput = {
    status:
      normalizedStatus === 'OPEN'
        ? { in: OPEN_STATUSES }
        : (normalizedStatus as SupplierStatus),
    ...(query
      ? {
          OR: [
            { businessName: { contains: query, mode: 'insensitive' } },
            { crNumber: { contains: query, mode: 'insensitive' } },
            { city: { contains: query, mode: 'insensitive' } },
            { countryCode: { contains: query, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [suppliers, statusGroups] = await Promise.all([
    prisma.supplier.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 80,
      select: {
        id: true,
        businessName: true,
        crNumber: true,
        city: true,
        countryCode: true,
        status: true,
        score: true,
        createdAt: true,
        _count: {
          select: { users: true, documents: true, warehouses: true },
        },
      },
    }),
    prisma.supplier.groupBy({ by: ['status'], _count: true }),
  ]);

  const count = (value: SupplierStatus) =>
    statusGroups.find((group) => group.status === value)?._count ?? 0;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <ShieldCheck size={16} aria-hidden /> SUPPLIER GOVERNANCE
          </p>
          <h1>طابور اعتماد الموردين</h1>
          <span>
            قرار ذو صلاحية مستقلة، انتقال حالة صريح، وسجل تدقيق لكل تغيير.
          </span>
        </div>
        <Link href="/" className={styles.back}>
          <ArrowLeft size={16} aria-hidden /> مركز العمليات
        </Link>
      </header>

      {error ? (
        <p className={styles.error} role="alert">
          الطلب غير صالح. افتح المورد من الطابور وأعد المحاولة.
        </p>
      ) : null}

      <section className={styles.summary} aria-label="ملخص حالات الموردين">
        <article>
          <span>بانتظار البدء</span>
          <strong>
            {count(SupplierStatus.PENDING).toLocaleString('ar-SA')}
          </strong>
          <Building2 size={20} aria-hidden />
        </article>
        <article>
          <span>تحت المراجعة</span>
          <strong>
            {count(SupplierStatus.UNDER_REVIEW).toLocaleString('ar-SA')}
          </strong>
          <FileCheck2 size={20} aria-hidden />
        </article>
        <article>
          <span>معتمد كلياً أو بقيود</span>
          <strong>
            {(
              count(SupplierStatus.APPROVED) + count(SupplierStatus.LIMITED)
            ).toLocaleString('ar-SA')}
          </strong>
          <UsersRound size={20} aria-hidden />
        </article>
      </section>

      <form className={styles.filters} role="search" method="get">
        <label>
          <span>بحث بالمنشأة أو السجل أو المدينة</span>
          <span className={styles.searchField}>
            <Search size={17} aria-hidden />
            <input name="q" defaultValue={query} maxLength={120} />
          </span>
        </label>
        <label>
          <span>الحالة</span>
          <select name="status" defaultValue={normalizedStatus}>
            <option value="OPEN">المفتوح للمراجعة</option>
            {Object.values(SupplierStatus).map((value) => (
              <option key={value} value={value}>
                {STATUS_AR[value]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">تطبيق</button>
      </form>

      <section className={styles.queue} aria-label="نتائج طابور الموردين">
        <div className={styles.queueHead}>
          <h2>المنشآت</h2>
          <span>{suppliers.length.toLocaleString('ar-SA')} نتيجة</span>
        </div>
        {suppliers.length === 0 ? (
          <div className={styles.empty}>
            <ShieldCheck size={30} aria-hidden />
            <strong>لا توجد منشآت مطابقة</strong>
            <span>
              غيّر المرشح أو البحث، أو ارجع لاحقاً عند وصول تسجيل جديد.
            </span>
          </div>
        ) : (
          <div className={styles.rows}>
            {suppliers.map((supplier) => (
              <Link
                href={`/suppliers/${supplier.id}`}
                key={supplier.id}
                className={styles.row}
              >
                <span className={`${styles.badge} ${styles[supplier.status]}`}>
                  {STATUS_AR[supplier.status]}
                </span>
                <div className={styles.identity}>
                  <strong>{supplier.businessName}</strong>
                  <small>
                    {supplier.countryCode} ·{' '}
                    {supplier.city ?? 'مدينة غير مسجلة'} ·{' '}
                    {supplier.crNumber
                      ? `سجل ${supplier.crNumber}`
                      : 'السجل غير مرفق'}
                  </small>
                </div>
                <div className={styles.readiness}>
                  <span>{supplier._count.documents} مستندات</span>
                  <span>{supplier._count.users} مستخدمين</span>
                  <span>{supplier._count.warehouses} مستودعات</span>
                </div>
                <small className={styles.age}>
                  {relativeDate(supplier.createdAt)}
                </small>
                <ArrowLeft size={18} aria-hidden />
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
