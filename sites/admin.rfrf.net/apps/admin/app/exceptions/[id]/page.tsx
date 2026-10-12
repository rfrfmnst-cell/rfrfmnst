import {
  ActorType,
  prisma,
  QuoteSourceType,
  QuoteStatus,
  RFQStatus,
  RiskLevel,
  SupplierStatus,
} from '@rafraf/db';
import {
  isVerifiedFitment,
  matchesVerifiedPart,
} from '@rafraf/shared/product-os/quote-policy';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  CircleAlert,
  Gauge,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TimerReset,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { resolveRiskException, rollbackRiskException } from '../actions';
import { ApprovedDecisionDialog } from './approved-decision-dialog';
import { ExceptionLockNotice } from './exception-lock-notice';
import styles from './exception.module.css';
import { SubmitButton } from '@rafraf/ui/submit-button';
import { requireAdminPermission } from '../../../lib/require-admin-session';
import { QUOTE_STATUS_AR, RISK_LEVEL_AR, ar } from '../../../lib/admin-labels';
import {
  DECISION_ACTIONS,
  LOCKED_RFQ_STATUSES,
  MUTABLE_RISKY_QUOTE_STATUSES,
  REVIEWABLE_RISK_LEVELS,
  ROLLBACK_WINDOW_MS,
} from '../../../lib/risk-exception-policy';

export const dynamic = 'force-dynamic';

function pct(value: number | null | undefined): number {
  return value == null ? 0 : Math.round(value * 100);
}

function asJsonRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export default async function ExceptionReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminPermission('RISK_REVIEW');
  const { id } = await params;

  const risk = await prisma.riskAssessment.findUnique({ where: { id } });
  if (!risk || risk.entityType !== 'quote') notFound();

  const quote = await prisma.quote.findUnique({
    where: { id: risk.entityId },
    include: {
      supplier: { select: { businessName: true, city: true } },
      sourceRegistry: { select: { name: true, country: true } },
      landedCost: true,
      rfqItem: {
        include: {
          rfq: { select: { id: true, code: true, status: true } },
        },
      },
    },
  });
  if (!quote) notFound();

  const now = new Date();
  const [latestRisk, alternativeCandidates, lastDecision, affectedOrders] =
    await Promise.all([
      prisma.riskAssessment.findFirst({
        where: { entityType: 'quote', entityId: quote.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, riskLevel: true, createdAt: true },
      }),
      prisma.quote.findMany({
        where: {
          rfqItemId: quote.rfqItemId,
          sourceType: QuoteSourceType.LOCAL,
          status: { in: [QuoteStatus.ACTIVE, QuoteStatus.APPROVED] },
          riskLevel: { notIn: REVIEWABLE_RISK_LEVELS },
          partId: quote.rfqItem.partId
            ? quote.rfqItem.partId
            : { equals: '__NO_VERIFIED_PART__' },
          fitmentConfidence: { gte: 0.85 },
          id: { not: quote.id },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        include: {
          supplier: {
            select: { businessName: true, city: true, status: true },
          },
          order: { select: { id: true } },
        },
        orderBy: [
          { decisionScore: 'desc' },
          { finalPrice: 'asc' },
          { id: 'desc' },
        ],
        take: 20,
      }),
      prisma.auditLog.findFirst({
        where: {
          entityType: 'risk_assessment',
          entityId: risk.id,
          actorType: ActorType.ADMIN,
          action: { in: DECISION_ACTIONS },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      prisma.order.count({ where: { quoteId: quote.id } }),
    ]);

  const candidateIds = alternativeCandidates.map((candidate) => candidate.id);
  const alternativeRiskHistory = candidateIds.length
    ? await prisma.riskAssessment.findMany({
        where: { entityType: 'quote', entityId: { in: candidateIds } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { entityId: true, riskLevel: true },
      })
    : [];
  const latestAlternativeRisk = new Map<string, RiskLevel>();
  for (const assessment of alternativeRiskHistory) {
    if (!latestAlternativeRisk.has(assessment.entityId)) {
      latestAlternativeRisk.set(assessment.entityId, assessment.riskLevel);
    }
  }

  const localAlternative = alternativeCandidates.find((candidate) => {
    const latestLevel = latestAlternativeRisk.get(candidate.id);
    return (
      !candidate.order &&
      candidate.supplier?.status === SupplierStatus.APPROVED &&
      matchesVerifiedPart(candidate, quote.rfqItem) &&
      (latestLevel == null || !REVIEWABLE_RISK_LEVELS.includes(latestLevel))
    );
  });

  const nonReviewable = !REVIEWABLE_RISK_LEVELS.includes(risk.riskLevel);
  const staleRisk = latestRisk?.id !== risk.id;
  const rfqLocked = LOCKED_RFQ_STATUSES.includes(quote.rfqItem.rfq.status);
  const orderLocked = affectedOrders > 0;
  const fitmentLocked = !isVerifiedFitment(quote.rfqItem);
  const locked =
    nonReviewable || staleRisk || rfqLocked || orderLocked || fitmentLocked;
  const overrideStatusLocked = !MUTABLE_RISKY_QUOTE_STATUSES.includes(
    quote.status,
  );
  const supplierCost = quote.landedCost
    ? Number(quote.landedCost.supplierPrice)
    : Number(quote.finalPrice);
  const landed = Number(quote.finalPrice);
  const importDeviation =
    supplierCost > 0
      ? Math.round(((landed - supplierCost) / supplierCost) * 100)
      : 0;
  const localPrice = localAlternative
    ? Number(localAlternative.finalPrice)
    : null;
  const localDelta =
    localPrice != null && landed > 0
      ? Math.round(((localPrice - landed) / landed) * 100)
      : null;
  const confidence = pct(quote.fitmentConfidence);
  const sourceName =
    quote.sourceRegistry?.name ?? quote.supplier?.businessName ?? 'مصدر دولي';
  const alias = `RISK-${risk.id.slice(-4).toUpperCase()}`;
  const approved = lastDecision?.action === 'risk.exception.local_override';
  const repricing =
    lastDecision?.action === 'risk.exception.repricing_requested';
  const rolledBack = lastDecision?.action === 'risk.exception.rollback';
  const decisionAfter = asJsonRecord(lastDecision?.after);
  const approvedAlternativeId =
    typeof decisionAfter?.approvedLocalQuoteId === 'string'
      ? decisionAfter.approvedLocalQuoteId
      : null;
  const approvedRecommendationId =
    typeof decisionAfter?.createdRecommendationResultId === 'string'
      ? decisionAfter.createdRecommendationResultId
      : null;
  const approvedAlternative = approvedAlternativeId
    ? alternativeCandidates.find(
        (candidate) => candidate.id === approvedAlternativeId,
      )
    : null;
  const approvedOutcome = Boolean(
    approved &&
    decisionAfter?.rejectedQuoteId === quote.id &&
    decisionAfter?.executionMode === 'human_approved' &&
    approvedRecommendationId &&
    quote.status === QuoteStatus.REJECTED &&
    quote.rfqItem.rfq.status === RFQStatus.QUOTES_READY &&
    approvedAlternative?.status === QuoteStatus.APPROVED,
  );
  const approvedDeliveryGainDays =
    approvedAlternative?.deliveryDaysMax != null &&
    quote.deliveryDaysMax != null
      ? Math.max(0, quote.deliveryDaysMax - approvedAlternative.deliveryDaysMax)
      : null;
  const rollbackRemainingMs = approved
    ? Math.max(
        0,
        ROLLBACK_WINDOW_MS -
          (Date.now() - (lastDecision?.createdAt.getTime() ?? 0)),
      )
    : 0;
  const rollbackRemainingMinutes = Math.ceil(rollbackRemainingMs / 60_000);
  const rollbackOpen = approved && rollbackRemainingMs > 0 && !locked;
  const reasons =
    risk.reasons && typeof risk.reasons === 'object'
      ? JSON.stringify(risk.reasons)
      : null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            RAFRAF COMMAND CENTER · PRODUCT OS V1.1
          </p>
          <h1>
            مراجعة الاستثناء <span dir="ltr">{alias}</span>
          </h1>
          <p>
            معاينة الأثر والتحقق من المصدر والبديل قبل أي قرار قابل للتدقيق.
          </p>
        </div>
        <Link href="/exceptions" className={styles.back}>
          <ArrowLeft size={16} aria-hidden /> طابور الاستثناءات
        </Link>
      </header>

      <section className={styles.metrics} aria-label="مؤشرات الاستثناء">
        <article>
          <span>طلبات مرتبطة</span>
          <strong>{affectedOrders}</strong>
          <small>RFQ {quote.rfqItem.rfq.code}</small>
        </article>
        <article className={styles.successMetric}>
          <span>سعر البديل المحلي</span>
          <strong>
            {localPrice == null ? '—' : `${localPrice.toFixed(0)} ر.س`}
          </strong>
          <small>
            {localDelta == null
              ? 'لا يوجد بديل آمن صالح'
              : `${localDelta >= 0 ? '+' : ''}${localDelta}% مقابل العرض الحالي`}
          </small>
        </article>
        <article className={styles.aiMetric}>
          <span>ثقة المطابقة</span>
          <strong>{confidence}%</strong>
          <small>fitment confidence</small>
        </article>
        <article className={styles.dangerMetric}>
          <span>زيادة landed cost</span>
          <strong>+{Math.max(importDeviation, 0)}%</strong>
          <small>مقابل سعر المصدر</small>
        </article>
      </section>

      <ExceptionLockNotice
        fitmentLocked={fitmentLocked}
        latestRiskLevel={latestRisk?.riskLevel}
        nonReviewable={nonReviewable}
        orderLocked={orderLocked}
        rfqLocked={rfqLocked}
        rfqStatus={quote.rfqItem.rfq.status}
        riskLevel={risk.riskLevel}
        staleRisk={staleRisk}
      />

      <div className={styles.grid}>
        <section className={styles.evidence}>
          <div className={styles.sectionHead}>
            <div>
              <span>الأثر والأدلة</span>
              <h2>راجع البيانات والمصدر والحوكمة</h2>
            </div>
            <ShieldCheck size={26} aria-hidden />
          </div>

          <article className={`${styles.evidenceRow} ${styles.danger}`}>
            <code>RISK</code>
            <div>
              <strong>{ar(RISK_LEVEL_AR, risk.riskLevel)}</strong>
              <small>{reasons ?? 'تقييم مخاطر مسجل بواسطة محرك رفرف'}</small>
            </div>
          </article>
          <article className={`${styles.evidenceRow} ${styles.warning}`}>
            <code>GLOBAL</code>
            <div>
              <strong>{sourceName}</strong>
              <small>
                {quote.sourceRegistry?.country ??
                  quote.supplier?.city ??
                  'مصدر عالمي'}{' '}
                · {landed.toFixed(0)} ر.س سعر نهائي
              </small>
            </div>
          </article>
          <article className={`${styles.evidenceRow} ${styles.success}`}>
            <code>LOCAL</code>
            <div>
              <strong>
                {localAlternative?.supplier?.businessName ??
                  'لا يوجد بديل محلي آمن صالح'}
              </strong>
              <small>
                {localAlternative
                  ? `${Number(localAlternative.finalPrice).toFixed(0)} ر.س · ${localAlternative.deliveryDaysMax ?? '—'} يوم · مورد معتمد`
                  : 'استبعد النظام البدائل المنتهية أو المرتبطة بطلب أو عالية المخاطر'}
              </small>
            </div>
          </article>
          <article className={`${styles.evidenceRow} ${styles.ai}`}>
            <code>GOV</code>
            <div>
              <strong>قرار بشري قابل للتراجع قبل التزام العميل</strong>
              <small>
                Audit Log كامل · نافذة تراجع يدوية 15 دقيقة · قفل بعد
                CUSTOMER_SELECTED
              </small>
            </div>
          </article>
        </section>

        <aside className={styles.decision} aria-labelledby="decision-title">
          <div className={styles.spectrum} aria-hidden />
          <Sparkles size={22} aria-hidden />
          <p>قرار مقترح · AI مساعد</p>
          <h2 id="decision-title" tabIndex={-1}>
            {localAlternative && !overrideStatusLocked
              ? 'اعتماد البديل المحلي ورفض العرض عالي المخاطر'
              : 'إعادة التسعير والبحث المحلي'}
          </h2>
          <span className={styles.riskCode}>
            {alias} · {ar(RISK_LEVEL_AR, risk.riskLevel)}
          </span>
          <p className={styles.explanation}>
            العرض الحالي {quote.sourceType === 'GLOBAL' ? 'دولي' : 'محلي'}
            ومصنف {ar(RISK_LEVEL_AR, risk.riskLevel)}.
            {localAlternative
              ? ` يوجد بديل محلي آمن من ${localAlternative.supplier?.businessName ?? 'مورد معتمد'} بسعر ${Number(localAlternative.finalPrice).toFixed(0)} ر.س.`
              : ' لا يوجد بديل محلي آمن صالح حاليًا، لذلك لا نوصي بتنفيذ استبدال تلقائي.'}
          </p>
          <div className={styles.governance}>
            <Gauge size={19} aria-hidden />
            <div>
              <strong>حوكمة القرار</strong>
              <small>
                المصدر محفوظ · الفعل مسجل · لا بيانات عميل حساسة في هذه الشاشة.
              </small>
            </div>
          </div>

          {locked ? (
            <div className={styles.pending}>
              <LockKeyhole size={20} aria-hidden />{' '}
              {nonReviewable
                ? 'هذا المستوى لا يحتاج قرار استثناء.'
                : staleRisk
                  ? 'التقييم مؤرشف؛ القرار متاح فقط على أحدث تقييم للمخاطر.'
                  : rfqLocked
                    ? 'القرار للعرض فقط؛ حالة RFQ تمنع أي تغيير.'
                    : fitmentLocked
                      ? 'التوافق غير مكتمل؛ ثبّت القطعة وأكمل المراجعة قبل القرار.'
                      : 'يوجد Order مرتبط؛ لا يسمح النظام باستبدال العرض.'}
            </div>
          ) : approved ? (
            <>
              <div className={styles.done}>
                <CheckCircle2 size={20} aria-hidden /> تم اعتماد البديل المحلي
                وتسجيل القرار.
              </div>
              {rollbackOpen ? (
                <form action={rollbackRiskException}>
                  <input type="hidden" name="riskId" value={risk.id} />
                  <SubmitButton
                    className={styles.secondary}
                    spinnerClassName={styles.submitSpinner}
                    spinnerSize={16}
                    type="submit"
                    pendingLabel="جارٍ تنفيذ التراجع..."
                  >
                    <RotateCcw size={16} aria-hidden /> التراجع يدويًا · متبقٍ
                    نحو {rollbackRemainingMinutes} د
                  </SubmitButton>
                </form>
              ) : (
                <div className={styles.safeNote}>
                  <TimerReset size={17} aria-hidden />
                  <span>
                    انتهت نافذة التراجع. أي تغيير جديد يجب أن يمر بقرار مستقل.
                  </span>
                </div>
              )}
            </>
          ) : repricing ? (
            <div className={styles.pending}>
              <TimerReset size={20} aria-hidden /> تم تسجيل طلب إعادة التسعير.
            </div>
          ) : (
            <>
              {rolledBack && (
                <div className={styles.pending}>
                  <RotateCcw size={20} aria-hidden /> تم التراجع واستعادة
                  الحالات السابقة. يمكنك إعادة تقييم الاستثناء.
                </div>
              )}
              <div className={styles.actions}>
                <form action={resolveRiskException}>
                  <input type="hidden" name="riskId" value={risk.id} />
                  <input type="hidden" name="quoteId" value={quote.id} />
                  <input type="hidden" name="alias" value={alias} />
                  <input type="hidden" name="decision" value="REPRICE" />
                  <SubmitButton
                    className={styles.secondary}
                    spinnerClassName={styles.submitSpinner}
                    spinnerSize={16}
                    type="submit"
                    pendingLabel="جارٍ تسجيل طلب إعادة التسعير..."
                  >
                    <X size={16} aria-hidden /> إعادة التسعير
                  </SubmitButton>
                </form>
                <form action={resolveRiskException}>
                  <input type="hidden" name="riskId" value={risk.id} />
                  <input type="hidden" name="quoteId" value={quote.id} />
                  <input
                    type="hidden"
                    name="alternativeQuoteId"
                    value={localAlternative?.id ?? ''}
                  />
                  <input type="hidden" name="alias" value={alias} />
                  <input type="hidden" name="decision" value="LOCAL_OVERRIDE" />
                  <SubmitButton
                    className={styles.primary}
                    spinnerClassName={styles.submitSpinner}
                    spinnerSize={16}
                    type="submit"
                    pendingLabel="جارٍ اعتماد البديل..."
                    disabled={!localAlternative || overrideStatusLocked}
                  >
                    <Check size={17} aria-hidden /> اعتماد البديل
                  </SubmitButton>
                </form>
              </div>
              {overrideStatusLocked && (
                <div className={styles.safeNote}>
                  <LockKeyhole size={17} aria-hidden />
                  <span>
                    حالة العرض الحالية {ar(QUOTE_STATUS_AR, quote.status)} لا
                    تسمح باستبداله؛ يمكن تسجيل إعادة التسعير فقط.
                  </span>
                </div>
              )}
            </>
          )}

          <div className={styles.safeNote}>
            <CircleAlert size={18} aria-hidden />
            <span>
              إذا لم يوجد بديل محلي آمن صالح يبقى زر الاعتماد معطلاً، ولا يغيّر
              النظام حالة العرض تلقائيًا.
            </span>
          </div>
        </aside>
      </div>

      {approvedOutcome && approvedAlternative && lastDecision && (
        <ApprovedDecisionDialog
          affectedOrders={affectedOrders}
          decisionId={lastDecision.id}
          deliveryGainDays={approvedDeliveryGainDays}
          fitmentConfidence={pct(approvedAlternative.fitmentConfidence)}
          returnFocusId="decision-title"
          rollbackMinutes={rollbackRemainingMinutes}
        />
      )}
    </main>
  );
}
