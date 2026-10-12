import { DisputeStatus, prisma } from '@rafraf/db';
import { ArrowLeft, Scale, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { requireAdminPermission } from '../../lib/require-admin-session';
import { disputeReasonLabel } from '../../lib/admin-labels';
import styles from './disputes.module.css';

export const dynamic = 'force-dynamic';

const ACTIVE = [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW];

export default async function DisputesPage() {
  await requireAdminPermission('OPERATIONS_READ');
  const [disputes, openCount, reviewCount] = await Promise.all([
    prisma.dispute.findMany({
      where: { status: { in: ACTIVE } },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: {
        customer: { include: { user: { select: { phone: true } } } },
        order: {
          select: {
            code: true,
            status: true,
            supplier: { select: { businessName: true } },
          },
        },
      },
    }),
    prisma.dispute.count({ where: { status: DisputeStatus.OPEN } }),
    prisma.dispute.count({ where: { status: DisputeStatus.UNDER_REVIEW } }),
  ]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>RAFRAF FINANCIAL OPERATIONS</p>
          <h1>طابور النزاعات</h1>
          <span>كل شكوى هنا توقف إفراج الضمان حتى الحسم.</span>
        </div>
        <Link href="/">
          <ArrowLeft size={16} aria-hidden /> مركز العمليات
        </Link>
      </header>

      <section className={styles.summary} aria-label="ملخص الطابور">
        <article>
          <span className={styles.muted}>إجمالي نشط</span>
          <strong>{disputes.length}</strong>
        </article>
        <article>
          <span className={styles.muted}>جديد</span>
          <strong>{openCount}</strong>
        </article>
        <article>
          <span className={styles.muted}>قيد المراجعة</span>
          <strong>{reviewCount}</strong>
        </article>
      </section>

      <section className={styles.queue} aria-label="النزاعات المفتوحة">
        {disputes.length === 0 ? (
          <div className={styles.empty}>
            <ShieldCheck size={30} aria-hidden />
            <strong>لا توجد نزاعات مفتوحة</strong>
            <span>تظهر هنا شكاوى العملاء ورفض الموردين.</span>
          </div>
        ) : (
          disputes.map((dispute) => (
            <Link
              key={dispute.id}
              href={`/disputes/${dispute.id}`}
              className={styles.row}
            >
              <div>
                <strong>{disputeReasonLabel(dispute.reason)}</strong>
                <small>
                  طلب {dispute.order.code} · {dispute.customer.fullName}
                </small>
              </div>
              <div>
                <span className={styles.badge}>
                  {dispute.status === DisputeStatus.OPEN
                    ? 'جديد'
                    : 'قيد المراجعة'}
                </span>
                <small>
                  {dispute.order.supplier?.businessName ?? 'بلا مورد'}
                </small>
              </div>
              <Scale size={20} aria-hidden />
            </Link>
          ))
        )}
      </section>
    </main>
  );
}
