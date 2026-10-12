import { prisma, RiskLevel } from '@rafraf/db';
import { ArrowLeft, CircleAlert, ShieldCheck, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { getOpenQuoteRiskAssessments } from '../../lib/open-exceptions';
import styles from './exceptions.module.css';
import { requireAdminPermission } from '../../lib/require-admin-session';
import { ar, RFQ_STATUS_AR, RISK_LEVEL_AR } from '../../lib/admin-labels';

export const dynamic = 'force-dynamic';

export default async function ExceptionsPage() {
  await requireAdminPermission('RISK_REVIEW');
  const { openRisks, resolvedCount } = await getOpenQuoteRiskAssessments();
  const quoteIds = openRisks.map((risk) => risk.entityId);
  const quotes = quoteIds.length
    ? await prisma.quote.findMany({
        where: { id: { in: quoteIds } },
        include: {
          supplier: { select: { businessName: true, city: true } },
          sourceRegistry: { select: { name: true, country: true } },
          rfqItem: {
            include: { rfq: { select: { code: true, status: true } } },
          },
        },
      })
    : [];
  const quoteById = new Map(quotes.map((quote) => [quote.id, quote]));
  const visibleRisks = openRisks.filter((risk) => quoteById.has(risk.entityId));

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>
            <Sparkles size={16} aria-hidden /> RAFRAF COMMAND CENTER · V1.1
          </p>
          <h1>طابور الاستثناءات</h1>
          <span>
            أحدث حالة مخاطر مرتفعة لكل عرض فعلي فقط
            {resolvedCount > 0 ? ` · حُسم ${resolvedCount}` : ''}.
          </span>
        </div>
        <Link href="/">
          <ArrowLeft size={16} aria-hidden /> مركز العمليات
        </Link>
      </header>

      <section className={styles.summary}>
        <article>
          <span>إجمالي مفتوح للمراجعة</span>
          <strong>{visibleRisks.length}</strong>
        </article>
        <article>
          <span>{ar(RISK_LEVEL_AR, RiskLevel.BLOCKED)}</span>
          <strong>
            {
              visibleRisks.filter(
                (risk) => risk.riskLevel === RiskLevel.BLOCKED,
              ).length
            }
          </strong>
        </article>
        <article>
          <span>{ar(RISK_LEVEL_AR, RiskLevel.HIGH)}</span>
          <strong>
            {
              visibleRisks.filter((risk) => risk.riskLevel === RiskLevel.HIGH)
                .length
            }
          </strong>
        </article>
      </section>

      <section className={styles.queue}>
        {visibleRisks.length === 0 ? (
          <div className={styles.empty}>
            <ShieldCheck size={28} aria-hidden />
            <strong>لا توجد استثناءات مرتفعة مفتوحة حاليًا</strong>
            <span>
              يظهر هنا آخر تقييم مخاطر لكل عرض إذا كان{' '}
              {ar(RISK_LEVEL_AR, RiskLevel.HIGH)} أو{' '}
              {ar(RISK_LEVEL_AR, RiskLevel.BLOCKED)} ولم يُحسم بعد.
            </span>
          </div>
        ) : (
          visibleRisks.map((risk) => {
            const quote = quoteById.get(risk.entityId);
            if (!quote) return null;
            const source =
              quote.sourceRegistry?.name ??
              quote.supplier?.businessName ??
              'مصدر غير مسمى';
            const alias = `RISK-${risk.id.slice(-4).toUpperCase()}`;
            return (
              <Link
                key={risk.id}
                href={`/exceptions/${risk.id}`}
                className={styles.row}
              >
                <span
                  className={`${styles.level} ${
                    risk.riskLevel === RiskLevel.BLOCKED
                      ? styles.blocked
                      : styles.high
                  }`}
                >
                  {ar(RISK_LEVEL_AR, risk.riskLevel)}
                </span>
                <div>
                  <code>{alias}</code>
                  <strong>{quote.rfqItem.freeTextAr ?? quote.code}</strong>
                  <small>
                    {source} · RFQ {quote.rfqItem.rfq.code}
                  </small>
                </div>
                <span className={styles.status}>
                  {ar(RFQ_STATUS_AR, quote.rfqItem.rfq.status)}
                </span>
                <CircleAlert size={20} aria-hidden />
              </Link>
            );
          })
        )}
      </section>
    </main>
  );
}
