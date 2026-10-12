import type { AdminRfqItem } from '../../../lib/admin-rfq-detail';
import { priceIncomingQuote } from '../../quote-write-actions';
import { QuoteRiskReviewForm } from './quote-risk-review-form';

const LABEL_AR: Record<string, string> = {
  BEST_OVERALL: 'ترشيح رفرف',
  CHEAPEST: 'الأرخص',
  FASTEST: 'الأسرع',
  HIGHEST_WARRANTY: 'الأعلى ضماناً',
  LOWEST_RISK: 'الأقل مخاطرة',
};

export function RfqQuoteList({
  canWriteQuotes,
  canReviewRisk,
  item,
  orderExists,
  recommendationText,
  rfqId,
}: {
  canWriteQuotes: boolean;
  canReviewRisk: boolean;
  item: AdminRfqItem | undefined;
  orderExists: boolean;
  recommendationText: string | null | undefined;
  rfqId: string;
}) {
  return (
    <div className="card-block">
      <h2>العروض ({item?.quotes.length ?? 0})</h2>
      {recommendationText ? (
        <p className="recommend">💡 {recommendationText}</p>
      ) : null}
      {item && item.quotes.length ? (
        <div className="quotes">
          {item.quotes.map((q) => (
            <article key={q.id} className="quote">
              <header>
                <strong>{q.supplier?.businessName ?? q.code}</strong>
                <span className="mono score">
                  {q.decisionScore?.toFixed(3) ?? '—'} / 0.88
                </span>
              </header>
              <div className="q-labels">
                {q.labels.map((l) => (
                  <span key={l} className={`tag t-${l}`}>
                    {LABEL_AR[l] ?? l}
                  </span>
                ))}
                <span className="tag src">
                  {q.sourceType === 'LOCAL' ? 'محلي' : 'دولي'}
                </span>
              </div>
              <dl className="q-facts mono">
                <div>
                  <dt>الواصل للعميل</dt>
                  <dd className="price">
                    {Number(q.finalPrice).toFixed(2)} ر.س
                  </dd>
                </div>
                <div>
                  <dt>تكلفة المورد</dt>
                  <dd>{Number(q.landedCost?.supplierPrice ?? 0).toFixed(2)}</dd>
                </div>
                <div>
                  <dt>هامش رفرف</dt>
                  <dd className="margin">
                    {Number(q.landedCost?.platformMargin ?? 0).toFixed(2)}
                  </dd>
                </div>
                <div>
                  <dt>وصول</dt>
                  <dd>{q.deliveryDaysMax ?? '—'} يوم</dd>
                </div>
                <div>
                  <dt>ضمان</dt>
                  <dd>{q.warrantyMonths} شهر</dd>
                </div>
                <div>
                  <dt>توافق</dt>
                  <dd>
                    {q.fitmentConfidence != null
                      ? `${Math.round(q.fitmentConfidence * 100)}%`
                      : '—'}
                  </dd>
                </div>
              </dl>
              {q.status === 'DRAFT' && canWriteQuotes ? (
                <form action={priceIncomingQuote} className="q-price-form">
                  <p className="incoming-note">
                    📥 وارد من المورد بسعر خام{' '}
                    <strong className="mono">
                      {Number(
                        q.landedCost?.supplierPrice ?? q.finalPrice,
                      ).toFixed(2)}
                    </strong>{' '}
                    — لا يظهر للعميل حتى تسعّره
                  </p>
                  <input type="hidden" name="quoteId" value={q.id} />
                  <input type="hidden" name="rfqId" value={rfqId} />
                  <div className="qgrid">
                    <label>
                      هامش رفرف
                      <input
                        name="platformMargin"
                        inputMode="decimal"
                        dir="ltr"
                        placeholder="12"
                        required
                      />
                    </label>
                    <label>
                      شحن محلي
                      <input
                        name="localShipping"
                        inputMode="decimal"
                        dir="ltr"
                        placeholder="0"
                      />
                    </label>
                    <label>
                      احتياطي مخاطر
                      <input
                        name="riskBuffer"
                        inputMode="decimal"
                        dir="ltr"
                        placeholder="0"
                      />
                    </label>
                    <label>
                      ثقة التوافق (0–1)
                      <input
                        name="fitmentConfidence"
                        inputMode="decimal"
                        dir="ltr"
                        placeholder="0.9"
                      />
                    </label>
                    <label>
                      المخاطر
                      <select name="riskLevel" defaultValue="" required>
                        <option value="" disabled>
                          اختر نتيجة المراجعة
                        </option>
                        <option value="LOW">منخفضة</option>
                        <option value="MEDIUM">متوسطة</option>
                        <option value="HIGH">عالية</option>
                        <option value="BLOCKED">محظورة</option>
                      </select>
                    </label>
                  </div>
                  <button type="submit">سعّر وفعّل العرض</button>
                </form>
              ) : q.status === 'DRAFT' ? (
                <p className="hint">عرض وارد؛ تسعيره يحتاج QUOTE_WRITE.</p>
              ) : q.status === 'SELECTED' ? (
                <p className="selected-note">✓ العرض المعتمد</p>
              ) : !orderExists ? (
                <div className="q-approve" role="status">
                  <p className="selected-note">
                    يخضع الظهور للعميل لاكتمال التوافق ومراجعة المورد والعرض
                  </p>
                  <p className="hint">
                    إنشاء الطلب يتم فقط بعد اعتماد العميل الصريح من حسابه.
                  </p>
                </div>
              ) : null}
              {canReviewRisk &&
              ['ACTIVE', 'APPROVED', 'SELECTED'].includes(q.status) ? (
                <QuoteRiskReviewForm
                  quoteId={q.id}
                  rfqId={rfqId}
                  riskLevel={q.riskLevel}
                />
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="empty">لا عروض بعد — أضف أول عرض من النموذج.</p>
      )}
    </div>
  );
}
