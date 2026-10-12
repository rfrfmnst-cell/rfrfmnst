import { QuoteStatus } from '@rafraf/db';
import {
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Inbox,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';
import { submitSupplierQuote } from '../actions';
import { ar, QUOTE_STATUS_AR } from '../../lib/supplier-labels';
import { SubmitButton } from '@rafraf/ui/submit-button';
import styles from './quotes.module.css';
import {
  supplierQuotesPageHref,
  type SupplierQuotesReadModel,
} from './quotes-read-model';

const ERROR_AR: Record<string, string> = {
  price: 'أدخل سعر مورد صالحًا أكبر من صفر.',
  days: 'مدة التوريد يجب أن تكون بين 1 و365 يومًا.',
  warranty: 'قيمة الضمان غير صالحة.',
  rfq: 'لم يعد RFQ مفتوحًا للتسعير أو يحتاج مراجعة قبل تقديم العرض.',
  dup: 'سبق أن قدمت عرضًا لهذا البند.',
  save: 'تعذر حفظ العرض. لم يتم إنشاء عرض جزئي، حاول مرة أخرى.',
};

function timeAgo(date: Date): string {
  const mins = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (mins < 1) return 'الآن';
  if (mins < 60) return `${mins} د`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} س`;
  return `${Math.floor(hours / 24)} ي`;
}

export function SupplierQuotesView({
  data,
  supplierName,
}: {
  data: SupplierQuotesReadModel;
  supplierName: string;
}) {
  const {
    activeCount,
    availableCount,
    avgFitment,
    currentPage,
    draftCount,
    err,
    firstResult,
    lastResult,
    normalizedStatus,
    ok,
    pageItems,
    pageNumbers,
    query,
    quotedByItem,
    totalFiltered,
    totalPages,
    wonCount,
  } = data;
  const pageHref = (targetPage: number) =>
    supplierQuotesPageHref(query, normalizedStatus, targetPage);

  return (
    <div className={styles.workspace}>
      <header className={styles.hero}>
        <div>
          <p className={styles.kicker}>
            <BadgeCheck size={17} aria-hidden /> {supplierName}
          </p>
          <h1>العروض والتسعير</h1>
          <p>
            أنشئ عرضك على طلب مطابق فقط. رفرف يحمي بيانات العميل، ويُكمل التسعير
            النهائي والمراجعة قبل العرض على العميل.
          </p>
        </div>
        <Link href="/" className={styles.back}>
          <ArrowLeft size={16} aria-hidden /> لوحة المورد
        </Link>
      </header>

      {ok && (
        <div
          className={`${styles.notice} ${styles.noticeSuccess}`}
          role="status"
        >
          <CheckCircle2 size={19} aria-hidden />
          <span>
            <b>تم إرسال عرضك إلى مراجعة رفرف</b>
            <small>RFQ {ok} · سيبقى DRAFT حتى يكتمل التسعير التشغيلي.</small>
          </span>
        </div>
      )}
      {err && (
        <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
          <TriangleAlert size={19} aria-hidden />
          <span>
            <b>لم يتم حفظ العرض</b>
            <small>{ERROR_AR[err] ?? 'تحقق من البيانات وحاول مرة أخرى.'}</small>
          </span>
        </div>
      )}

      <section className={styles.metrics} aria-label="مؤشرات العروض">
        <article>
          <span>فرص مفتوحة</span>
          <strong>{availableCount}</strong>
          <small>كل البنود الجاهزة لتسعيرك</small>
        </article>
        <article className={styles.aiMetric}>
          <span>ثقة المطابقة</span>
          <strong>{avgFitment}%</strong>
          <small>متوسط كل الفرص الحالية</small>
        </article>
        <article>
          <span>قيد المراجعة</span>
          <strong>{draftCount + activeCount}</strong>
          <small>
            {draftCount} مسودة · {activeCount} نشط
          </small>
        </article>
        <article className={styles.successMetric}>
          <span>عروض مختارة</span>
          <strong>{wonCount}</strong>
          <small>اختارها العملاء</small>
        </article>
      </section>

      <section className={styles.aiRail}>
        <div className={styles.spectrum} aria-hidden />
        <Sparkles size={22} aria-hidden />
        <div>
          <strong>مساعد قرار المورد</strong>
          <span>
            يعرض فقط بنود RFQ المكتملة المطابقة ولا يكشف اسم العميل أو جواله أو
            عروض المنافسين أو السعر النهائي للعميل.
          </span>
        </div>
        <span className={styles.confidence}>FITMENT · {avgFitment}%</span>
      </section>

      <form className={styles.toolbar} method="GET">
        <label>
          <Search size={16} aria-hidden />
          <input
            name="q"
            aria-label="البحث في عروض وطلبات التسعير"
            defaultValue={query}
            maxLength={120}
            placeholder="ابحث برقم RFQ أو اسم القطعة أو OEM"
          />
        </label>
        <select
          name="status"
          defaultValue={normalizedStatus}
          aria-label="حالة العرض"
        >
          <option value="ALL">كل الحالات</option>
          <option value="OPEN">لم أقدّم عرضًا</option>
          <option value="DRAFT">مسودة</option>
          <option value="ACTIVE">قيد المراجعة</option>
          <option value="APPROVED">معتمد</option>
          <option value="SELECTED">اختاره العميل</option>
        </select>
        <button type="submit">تطبيق</button>
      </form>

      <div className={styles.pageMeta} role="status">
        <span>
          عرض {firstResult.toLocaleString('ar-SA')}–
          {lastResult.toLocaleString('ar-SA')} من{' '}
          {totalFiltered.toLocaleString('ar-SA')} نتيجة
        </span>
        <small>
          صفحة {currentPage.toLocaleString('ar-SA')} من{' '}
          {totalPages.toLocaleString('ar-SA')}
        </small>
      </div>

      <section className={styles.tableCard} aria-label="قائمة فرص وعروض المورد">
        <div className={styles.tableHead}>
          <span>RFQ</span>
          <span>القطعة</span>
          <span>المركبة</span>
          <span>المدينة</span>
          <span>العمر</span>
          <span>الحالة</span>
        </div>

        {pageItems.length === 0 ? (
          <article className={styles.empty} role="status">
            <span className={styles.emptyIcon} aria-hidden>
              <Inbox size={36} />
            </span>
            <h2>لا توجد نتائج مطابقة</h2>
            <p>
              {query || normalizedStatus !== 'ALL'
                ? 'لم نجد عروضًا أو فرصًا توافق البحث والفلاتر الحالية. امسح الفلاتر أو اعرض الفرص المفتوحة.'
                : 'لا توجد فرص تسعير جاهزة الآن. يمكنك تجهيز الكتالوج، وسنُظهر الطلبات المطابقة فور وصولها.'}
            </p>
            <small>
              البحث: {query || 'بدون كلمات'} · الحالة: {normalizedStatus}
            </small>
            <div className={styles.emptyActions}>
              <a className={styles.emptyPrimary} href="/quotes">
                مسح الفلاتر
              </a>
              <a href="/quotes?status=OPEN">الفرص المفتوحة</a>
              <a href="/catalog/import">استيراد الكتالوج</a>
            </div>
          </article>
        ) : (
          <div className={styles.rows}>
            {pageItems.map((item) => {
              const rfq = item.rfq;
              const quote = quotedByItem.get(item.id);
              const fitment = Math.round((item.fitmentConfidence ?? 0) * 100);
              const supplierPrice = quote
                ? quote.landedCost?.supplierPrice != null
                  ? Number(quote.landedCost.supplierPrice)
                  : quote.status === QuoteStatus.DRAFT
                    ? Number(quote.finalPrice)
                    : null
                : null;
              return (
                <article key={item.id} className={styles.row}>
                  <div className={styles.rowSummary}>
                    <code dir="ltr">{rfq.code}</code>
                    <div>
                      <strong>{item.freeTextAr ?? 'قطعة غير مسماة'}</strong>
                      <small>
                        مطابقة موثقة {fitment}%
                        {item.oemNumber ? (
                          <>
                            {' · OEM '}
                            <bdi dir="ltr">{item.oemNumber}</bdi>
                          </>
                        ) : null}
                      </small>
                    </div>
                    <span>
                      {rfq.vehicle
                        ? `${rfq.vehicle.make} ${rfq.vehicle.model} ${rfq.vehicle.year}`
                        : '—'}
                    </span>
                    <span>{rfq.customer.city ?? '—'}</span>
                    <span className={styles.age}>
                      <Clock3 size={14} aria-hidden /> {timeAgo(item.createdAt)}
                    </span>
                    {quote ? (
                      <span
                        className={`${styles.status} ${
                          styles[`q${quote.status}`] ?? ''
                        }`}
                      >
                        {ar(QUOTE_STATUS_AR, quote.status)}
                      </span>
                    ) : (
                      <span className={`${styles.status} ${styles.open}`}>
                        مفتوح للتسعير
                      </span>
                    )}
                  </div>

                  {quote ? (
                    <div className={styles.quoteSnapshot}>
                      <FileCheck2 size={18} aria-hidden />
                      <span>
                        <b>
                          {supplierPrice == null
                            ? '—'
                            : `${supplierPrice.toFixed(2)} ر.س`}
                        </b>
                        <small>
                          سعرك المسجل · توريد {quote.deliveryDaysMin ?? '—'} يوم
                          · ضمان {quote.warrantyMonths} شهر
                        </small>
                      </span>
                      {quote.status === QuoteStatus.SELECTED && (
                        <CheckCircle2 size={20} aria-hidden />
                      )}
                    </div>
                  ) : (
                    <details className={styles.quoteEditor}>
                      <summary>
                        <span>
                          <TrendingUp size={17} aria-hidden /> فتح التسعير
                        </span>
                        <small>
                          سعر المورد فقط — رفرف يحسب landed cost لاحقًا
                        </small>
                      </summary>
                      <form action={submitSupplierQuote}>
                        <input type="hidden" name="returnTo" value="/quotes" />
                        <input type="hidden" name="rfqId" value={rfq.id} />
                        <input type="hidden" name="rfqItemId" value={item.id} />
                        <div className={styles.formGrid}>
                          <label>
                            سعر المورد (ر.س)
                            <input
                              name="supplierPrice"
                              type="number"
                              step="0.01"
                              min="1"
                              required
                            />
                          </label>
                          <label>
                            مدة التوريد (أيام)
                            <input
                              name="deliveryDays"
                              type="number"
                              min="1"
                              max="365"
                              required
                            />
                          </label>
                          <label>
                            الضمان (شهور)
                            <input
                              name="warrantyMonths"
                              type="number"
                              min="0"
                              max="120"
                              defaultValue={0}
                              required
                            />
                          </label>
                          <label>
                            حالة القطعة
                            <input
                              name="condition"
                              maxLength={60}
                              placeholder="جديد / OEM / بديل ممتاز"
                            />
                          </label>
                        </div>
                        <div className={styles.formFooter}>
                          <span>
                            <ShieldCheck size={16} aria-hidden /> العرض يذهب
                            لمراجعة رفرف قبل العميل.
                          </span>
                          <SubmitButton pendingLabel="جارٍ إرسال العرض…">
                            <Send size={16} aria-hidden /> إرسال العرض
                          </SubmitButton>
                        </div>
                      </form>
                    </details>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {totalPages > 1 && (
        <nav className={styles.pagination} aria-label="صفحات فرص التسعير">
          {currentPage > 1 ? (
            <a href={pageHref(currentPage - 1)}>السابق</a>
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
                <a key={pageNumber} href={pageHref(pageNumber)}>
                  {pageNumber.toLocaleString('ar-SA')}
                </a>
              ),
            )}
          </div>
          {currentPage < totalPages ? (
            <a href={pageHref(currentPage + 1)}>التالي</a>
          ) : (
            <span aria-disabled="true">التالي</span>
          )}
        </nav>
      )}
    </div>
  );
}
