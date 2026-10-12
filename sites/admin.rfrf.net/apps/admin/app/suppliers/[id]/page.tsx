import { prisma, SupplierStatus } from '@rafraf/db';
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  Check,
  CircleAlert,
  FileCheck2,
  History,
  LockKeyhole,
  ShieldCheck,
  UserRoundCheck,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminPermission } from '../../../lib/require-admin-session';
import {
  approveSupplier,
  limitSupplier,
  rejectSupplier,
  startSupplierReview,
  reviewSupplierRisk,
} from '../actions';
import { SupplierRiskFields } from '../risk-review-fields';
import { DecisionSubmitButton } from '../decision-submit-button';
import styles from '../suppliers.module.css';
import {
  ar,
  DOCUMENT_STATUS_AR,
  DOCUMENT_TYPE_AR,
} from '../../../lib/admin-labels';

export const dynamic = 'force-dynamic';

const STATUS_AR: Record<SupplierStatus, string> = {
  PENDING: 'بانتظار المراجعة',
  UNDER_REVIEW: 'تحت المراجعة',
  APPROVED: 'معتمد',
  LIMITED: 'معتمد بقيود',
  SUSPENDED: 'موقوف',
  REJECTED: 'مرفوض',
};

const RESULT_AR: Record<string, string> = {
  applied: 'تم حفظ القرار وتسجيله في سجل التدقيق.',
  replayed: 'هذا القرار مطبّق مسبقاً؛ لم تُنشأ كتابة أو عملية تدقيق مكررة.',
};

const ERROR_AR: Record<string, string> = {
  conflict: 'تغيّرت حالة المورد في جلسة أخرى. الصفحة تعرض أحدث حالة الآن.',
  transition: 'الانتقال المطلوب غير مسموح من الحالة الحالية.',
  not_found: 'لم يعد سجل المورد متاحاً.',
  invalid_request: 'بيانات القرار غير صالحة.',
  invalid_id: 'معرّف القرار غير صالح.',
  reason_required: 'سبب القرار مطلوب للرفض أو التقييد.',
  reason_too_long: 'سبب القرار يتجاوز 500 حرف.',
  document_required:
    'لا يمكن بدء المراجعة قبل إرفاق سجل تجاري أو وثيقة عمل حر صالحة.',
  risk_review_required:
    'يلزم تقييم مخاطر صريح. الاعتماد الكامل يقبل مستوى منخفضاً أو متوسطاً فقط.',
};

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function maskedPhone(phone: string): string {
  return phone.length > 7
    ? `${phone.slice(0, 6)}••••${phone.slice(-2)}`
    : 'غير متاح';
}

function decisionReason(after: unknown): string | null {
  const value = jsonRecord(after)?.reason;
  return typeof value === 'string' && value ? value : null;
}

function DecisionReasonForm({
  supplierId,
  expectedStatus,
  action,
  title,
  tone,
}: {
  supplierId: string;
  expectedStatus: SupplierStatus;
  action: (formData: FormData) => Promise<never>;
  title: string;
  tone: 'warning' | 'danger';
}) {
  return (
    <form action={action} className={styles.reasonForm}>
      <input type="hidden" name="supplierId" value={supplierId} />
      <input type="hidden" name="expectedStatus" value={expectedStatus} />
      <label>
        <span>{title}</span>
        <textarea
          name="reason"
          required
          minLength={3}
          maxLength={500}
          rows={3}
          placeholder="اكتب سبباً تشغيلياً واضحاً دون بيانات اتصال…"
        />
      </label>
      <DecisionSubmitButton tone={tone}>{title}</DecisionSubmitButton>
    </form>
  );
}

export default async function SupplierReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ result?: string; error?: string; status?: string }>;
}) {
  const admin = await requireAdminPermission('SUPPLIER_WRITE');
  const { id } = await params;
  const { result, error } = await searchParams;

  const [supplier, history, currentRisk] = await Promise.all([
    prisma.supplier.findUnique({
      where: { id },
      include: {
        documents: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, type: true, status: true, createdAt: true },
        },
        _count: {
          select: {
            users: true,
            documents: true,
            warehouses: true,
            inventory: true,
            quotes: true,
            orders: true,
            payouts: true,
          },
        },
      },
    }),
    prisma.auditLog.findMany({
      where: {
        entityType: 'supplier',
        entityId: id,
        action: { startsWith: 'supplier.review.' },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
    }),
    prisma.riskAssessment.findFirst({
      where: { entityType: 'supplier', entityId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, riskLevel: true, createdAt: true },
    }),
  ]);
  if (!supplier) notFound();

  const pending = supplier.status === SupplierStatus.PENDING;
  const underReview = supplier.status === SupplierStatus.UNDER_REVIEW;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>
            <ShieldCheck size={16} aria-hidden /> SUPPLIER REVIEW
          </p>
          <h1>{supplier.businessName}</h1>
          <span>
            مراجعة هوية المنشأة وجاهزيتها قبل منح الوصول إلى طلبات التسعير.
          </span>
        </div>
        <Link href="/suppliers" className={styles.back}>
          <ArrowLeft size={16} aria-hidden /> طابور الموردين
        </Link>
      </header>

      {result && RESULT_AR[result] ? (
        <p className={styles.success} role="status" aria-live="polite">
          <BadgeCheck size={18} aria-hidden /> {RESULT_AR[result]}
        </p>
      ) : null}
      {error && ERROR_AR[error] ? (
        <p className={styles.error} role="alert">
          <CircleAlert size={18} aria-hidden /> {ERROR_AR[error]}
        </p>
      ) : null}

      <section className={styles.detailGrid}>
        <article className={styles.profileCard}>
          <div className={styles.profileHead}>
            <div>
              <span className={`${styles.badge} ${styles[supplier.status]}`}>
                {STATUS_AR[supplier.status]}
              </span>
              <h2>ملف المنشأة</h2>
            </div>
            <Building2 size={28} aria-hidden />
          </div>
          <dl className={styles.facts}>
            <div>
              <dt>رقم التسجيل القانوني</dt>
              <dd>{supplier.crNumber ?? 'غير مرفق'}</dd>
            </div>
            <div>
              <dt>دولة التسجيل</dt>
              <dd dir="ltr">{supplier.countryCode}</dd>
            </div>
            <div>
              <dt>المدينة</dt>
              <dd>{supplier.city ?? 'غير مسجلة'}</dd>
            </div>
            <div>
              <dt>هاتف التواصل</dt>
              <dd dir="ltr">{maskedPhone(supplier.contactPhone)}</dd>
            </div>
            <div>
              <dt>البريد</dt>
              <dd>{supplier.contactEmail ?? 'غير مسجل'}</dd>
            </div>
            <div>
              <dt>تاريخ التسجيل</dt>
              <dd>
                {new Intl.DateTimeFormat('ar-SA', {
                  dateStyle: 'medium',
                }).format(supplier.createdAt)}
              </dd>
            </div>
            <div>
              <dt>درجة المورد</dt>
              <dd>
                {supplier.score.toLocaleString('ar-SA')} /{' '}
                {(100).toLocaleString('ar-SA')}
              </dd>
            </div>
          </dl>
          <div className={styles.countGrid}>
            <span>{supplier._count.users} مستخدمين</span>
            <span>{supplier._count.documents} مستندات</span>
            <span>{supplier._count.warehouses} مستودعات</span>
            <span>{supplier._count.inventory} عناصر مخزون</span>
            <span>{supplier._count.quotes} عروض</span>
            <span>{supplier._count.orders} طلبات</span>
          </div>
        </article>

        <aside className={styles.decisionCard} aria-labelledby="decision-title">
          <p className={styles.kicker}>
            <LockKeyhole size={16} aria-hidden /> SUPPLIER_WRITE
          </p>
          <h2 id="decision-title">قرار الاعتماد</h2>
          <p role="status">
            تقييم المخاطر الحالي: {currentRisk?.riskLevel ?? 'لم يُراجع بعد'}
            {currentRisk && ['HIGH', 'BLOCKED'].includes(currentRisk.riskLevel)
              ? ' — عروض المورد وإتمام الشراء موقوفة حتى مراجعة القرار.'
              : ''}
          </p>
          {pending ? (
            <>
              <p>
                ابدأ المراجعة أولاً لتثبيت ملكية الحالة ومنع الاعتماد المباشر.
              </p>
              <form action={startSupplierReview} className={styles.quickForm}>
                <input type="hidden" name="supplierId" value={supplier.id} />
                <input
                  type="hidden"
                  name="expectedStatus"
                  value={supplier.status}
                />
                <DecisionSubmitButton>
                  <FileCheck2 size={17} aria-hidden /> بدء المراجعة
                </DecisionSubmitButton>
              </form>
              <DecisionReasonForm
                supplierId={supplier.id}
                expectedStatus={supplier.status}
                action={rejectSupplier}
                title="رفض طلب التسجيل"
                tone="danger"
              />
            </>
          ) : null}
          {underReview ? (
            <>
              <p>
                الاعتماد الكامل يفتح التوريد. المقيّد يبقى للقراءة فقط حتى يتوفر
                نطاق فئات أو سقف تشغيلي صريح.
              </p>
              <form action={approveSupplier} className={styles.quickForm}>
                <input type="hidden" name="supplierId" value={supplier.id} />
                <input
                  type="hidden"
                  name="expectedStatus"
                  value={supplier.status}
                />
                <label>
                  <span>المستند القانوني المعتمد</span>
                  <select name="documentId" required defaultValue="">
                    <option value="" disabled>
                      اختر المستند بعد مراجعته
                    </option>
                    {supplier.documents
                      .filter((document) => document.status === 'PENDING')
                      .map((document) => (
                        <option key={document.id} value={document.id}>
                          {ar(DOCUMENT_TYPE_AR, document.type)} ·{' '}
                          {new Intl.DateTimeFormat('ar-SA', {
                            dateStyle: 'medium',
                          }).format(document.createdAt)}
                        </option>
                      ))}
                  </select>
                </label>
                <SupplierRiskFields approval />
                <DecisionSubmitButton>
                  <Check size={17} aria-hidden /> اعتماد كامل
                </DecisionSubmitButton>
              </form>
              <DecisionReasonForm
                supplierId={supplier.id}
                expectedStatus={supplier.status}
                action={limitSupplier}
                title="اعتماد بقيود"
                tone="warning"
              />
              <DecisionReasonForm
                supplierId={supplier.id}
                expectedStatus={supplier.status}
                action={rejectSupplier}
                title="رفض الطلب"
                tone="danger"
              />
            </>
          ) : null}
          {supplier.status === SupplierStatus.APPROVED &&
          admin.permissions.includes('RISK_REVIEW') ? (
            <form action={reviewSupplierRisk} className={styles.quickForm}>
              <input type="hidden" name="supplierId" value={supplier.id} />
              <SupplierRiskFields />
              <input
                type="hidden"
                name="expectedAssessmentId"
                value={currentRisk?.id ?? ''}
              />
              <DecisionSubmitButton>تسجيل مراجعة المخاطر</DecisionSubmitButton>
            </form>
          ) : null}
          {!pending && !underReview ? (
            <div className={styles.closedDecision}>
              {supplier.status === SupplierStatus.APPROVED ? (
                <UserRoundCheck size={26} aria-hidden />
              ) : supplier.status === SupplierStatus.REJECTED ? (
                <X size={26} aria-hidden />
              ) : (
                <LockKeyhole size={26} aria-hidden />
              )}
              <strong>لا يوجد قرار تسجيل مفتوح</strong>
              <span>
                الحالة الحالية: {STATUS_AR[supplier.status]}. تغييرات دورة ما
                بعد الاعتماد خارج نطاق هذا الطابور.
              </span>
            </div>
          ) : null}
        </aside>
      </section>

      <section className={styles.lowerGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>
              <FileCheck2 size={19} aria-hidden /> المستندات
            </h2>
            <span>{supplier.documents.length} ملفاً</span>
          </div>
          {supplier.documents.length === 0 ? (
            <p className={styles.emptyLine}>لم تُرفع مستندات للمنشأة بعد.</p>
          ) : (
            <ul className={styles.documentList}>
              {supplier.documents.map((document) => (
                <li key={document.id}>
                  <strong>{ar(DOCUMENT_TYPE_AR, document.type)}</strong>
                  <span>
                    {ar(DOCUMENT_STATUS_AR, document.status, 'دون حالة مراجعة')}
                  </span>
                  <Link href={`/api/supplier-documents/${document.id}`}>
                    تنزيل آمن
                  </Link>
                  <small>
                    {new Intl.DateTimeFormat('ar-SA', {
                      dateStyle: 'medium',
                    }).format(document.createdAt)}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>
              <History size={19} aria-hidden /> سجل القرارات
            </h2>
            <span>{history.length} حركة</span>
          </div>
          {history.length === 0 ? (
            <p className={styles.emptyLine}>لا توجد قرارات مسجلة بعد.</p>
          ) : (
            <ol className={styles.history}>
              {history.map((entry) => {
                const before = jsonRecord(entry.before)?.status;
                const after = jsonRecord(entry.after)?.status;
                const reason = decisionReason(entry.after);
                return (
                  <li key={entry.id}>
                    <strong>
                      {String(before ?? '—')} ← {String(after ?? '—')}
                    </strong>
                    <span>{reason ?? 'قرار بلا سبب إضافي'}</span>
                    <small>
                      {new Intl.DateTimeFormat('ar-SA', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(entry.createdAt)}
                    </small>
                  </li>
                );
              })}
            </ol>
          )}
        </article>
      </section>
    </main>
  );
}
