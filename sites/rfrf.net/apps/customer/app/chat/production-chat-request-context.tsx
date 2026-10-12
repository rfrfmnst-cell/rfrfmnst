import { CheckCircle2, ClipboardList, ImageIcon } from 'lucide-react';
import { summarizeRequestContext } from './request-context';
import type {
  SelectedQuoteSummary,
  ThreadPayload,
} from './production-chat-types';

export function RequestContextPanel({
  thread,
  refreshing,
  selectedQuote,
}: {
  thread: ThreadPayload;
  refreshing: boolean;
  selectedQuote: SelectedQuoteSummary | null;
}) {
  const summary = summarizeRequestContext(thread.draft, thread.rfqId);
  const status = summary.rfqLinked
    ? 'طلب التسعير مرتبط'
    : summary.readyForReview
      ? 'جاهز للمراجعة'
      : 'نجمع التفاصيل';

  return (
    <aside
      className="rf-request-context"
      aria-labelledby="request-context-title"
    >
      <header>
        <span className="rf-request-context-icon">
          <ClipboardList size={20} aria-hidden="true" />
        </span>
        <div>
          <strong id="request-context-title">ملخص طلبك</strong>
          <small>يتحدث مباشرة من المحادثة المحفوظة</small>
        </div>
        <span
          className={`rf-request-context-status ${summary.readyForReview ? 'is-ready' : ''}`}
          role="status"
        >
          {refreshing ? 'جاري التحديث…' : status}
        </span>
      </header>

      <div className="rf-request-progress">
        <div>
          <span>اكتمال البيانات الأساسية</span>
          <b>{summary.progress}%</b>
        </div>
        <span
          role="progressbar"
          aria-label="اكتمال بيانات الطلب الأساسية"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={summary.progress}
        >
          <i style={{ width: `${summary.progress}%` }} />
        </span>
      </div>

      <dl className="rf-request-details">
        <div>
          <dt>القطعة</dt>
          <dd>{summary.partText ?? 'بانتظار وصفك'}</dd>
        </div>
        <div>
          <dt>المركبة</dt>
          <dd>{summary.vehicle ?? 'بانتظار الماركة والموديل والسنة'}</dd>
        </div>
        <div>
          <dt>OEM</dt>
          <dd>
            {summary.pendingPartNumber ? (
              <>
                <bdi dir="ltr">{summary.pendingPartNumber}</bdi>
                <small>بانتظار تأكيدك من بطاقة المحادثة</small>
              </>
            ) : (
              <bdi dir={summary.oemNumber ? 'ltr' : undefined}>
                {summary.oemNumber ?? 'اختياري عند توفره'}
              </bdi>
            )}
          </dd>
        </div>
        <div>
          <dt>VIN</dt>
          <dd>{summary.hasVin ? 'مضاف ومحمي' : 'اختياري عند الحاجة'}</dd>
        </div>
      </dl>

      <div className="rf-request-evidence">
        <ImageIcon size={17} aria-hidden="true" />
        <span>الصور المرفقة</span>
        <strong>{summary.attachmentCount} / 2</strong>
      </div>

      {selectedQuote ? (
        <section
          className="rf-selected-quote"
          aria-labelledby="selected-quote-title"
        >
          <div>
            <span id="selected-quote-title">العرض المختار للمراجعة</span>
            <strong>
              {selectedQuote.finalPrice}{' '}
              {selectedQuote.currency === 'SAR'
                ? 'ر.س'
                : selectedQuote.currency}
            </strong>
          </div>
          <dl>
            <div>
              <dt>الوصول</dt>
              <dd>
                {selectedQuote.deliveryDaysMin == null
                  ? 'بعد تأكيد المورد'
                  : `${selectedQuote.deliveryDaysMin}${
                      selectedQuote.deliveryDaysMax &&
                      selectedQuote.deliveryDaysMax !==
                        selectedQuote.deliveryDaysMin
                        ? `–${selectedQuote.deliveryDaysMax}`
                        : ''
                    } أيام`}
              </dd>
            </div>
            <div>
              <dt>الضمان</dt>
              <dd>
                {selectedQuote.warrantyMonths
                  ? `${selectedQuote.warrantyMonths} شهراً`
                  : 'حسب العرض'}
              </dd>
            </div>
            <div>
              <dt>التوافق</dt>
              <dd>
                {selectedQuote.fitmentConfidence == null
                  ? 'يعاد فحصه عند الاعتماد'
                  : `${Math.round(selectedQuote.fitmentConfidence * 100)}% موثّق`}
              </dd>
            </div>
            <div>
              <dt>المصدر</dt>
              <dd>
                {selectedQuote.sourceType === 'LOCAL'
                  ? 'مورد محلي معتمد'
                  : selectedQuote.sourceType === 'GLOBAL'
                    ? 'استيراد موثّق'
                    : 'مصدر موثّق'}
              </dd>
            </div>
          </dl>
          <small>
            هذه معاينة للعرض الذي اخترته؛ يعيد الخادم فحص السعر والصلاحية
            والتوافق عند الموافقة.
          </small>
        </section>
      ) : null}

      {summary.rfqLinked ? (
        <p className="rf-request-context-note is-complete">
          <CheckCircle2 size={16} aria-hidden="true" />
          تم إنشاء طلب التسعير بموافقتك وربطه بهذه المحادثة.
        </p>
      ) : summary.missingFields.length ? (
        <p className="rf-request-context-note">
          المتبقي قبل بطاقة الموافقة: {summary.missingFields.join('، ')}.
        </p>
      ) : (
        <p className="rf-request-context-note is-complete">
          <CheckCircle2 size={16} aria-hidden="true" />
          راجع الملخص، ثم وافق على إنشاء طلب التسعير داخل المحادثة.
        </p>
      )}

      <footer>لا يُنشأ RFQ ولا يُعتمد عرض إلا من بطاقة موافقة صريحة.</footer>
    </aside>
  );
}
