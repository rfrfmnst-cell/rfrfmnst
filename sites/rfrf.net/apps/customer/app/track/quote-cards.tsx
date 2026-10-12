'use client';

/**
 * بطاقات مقارنة العروض + اعتماد العميل الذاتي (الزر البرتقالي).
 * تجسيد صورة المرجعية: بطاقات راديو، ترشيح رفرف، درع التوافق، زر مالي واحد.
 * Rule 2: البيانات القادمة أصلاً منقّاة (لا مورد/تكلفة/هامش).
 */

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  approveQuoteAsCustomer,
  getQuotesComparison,
  type CustomerApproveState,
  type CustomerQuoteCard,
  type QuotesComparison,
} from '../actions';

const LABEL_AR: Record<string, string> = {
  BEST_OVERALL: 'ترشيح رفرف',
  CHEAPEST: 'الأرخص',
  FASTEST: 'الأسرع',
  HIGHEST_WARRANTY: 'الأعلى ضماناً',
  LOWEST_RISK: 'الأقل مخاطرة',
};

const MARKET_AR: Record<CustomerQuoteCard['market'], string> = {
  SAUDI: 'السوق السعودي',
  GCC: 'السوق الخليجي',
  GLOBAL: 'السوق العالمي',
};

const initialApprove: CustomerApproveState = {};

export function QuoteCards({ code }: { code: string }) {
  const [data, setData] = useState<QuotesComparison | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [state, action, pending] = useActionState(
    approveQuoteAsCustomer,
    initialApprove,
  );

  useEffect(() => {
    let alive = true;
    getQuotesComparison(code).then((d) => {
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
  }, [code]);

  if (data?.authRequired) {
    return (
      <section className="card qc-done" aria-live="polite">
        <h3>سجّل الدخول لعرض العروض</h3>
        <p>{data.error}</p>
        <Link href="/login">تسجيل الدخول</Link>
      </section>
    );
  }

  if (!data?.ok || !data.quotes?.length) return null;

  if (state.ok && state.orderCode) {
    return (
      <section className="card success qc-done" aria-live="polite">
        <h3>تم اعتماد عرضك ✓</h3>
        <p>
          رقم أمر الشراء: <strong dir="ltr">{state.orderCode}</strong>
        </p>
        <p>
          بقيت خطوة الدفع الإلكتروني الآمن. لن تدخل بيانات البطاقة في رفرف؛
          ستنتقل إلى صفحة المزوّد المستضافة.
        </p>
        <Link
          className="btn primary"
          href={`/track?code=${encodeURIComponent(state.orderCode)}`}
        >
          الانتقال للدفع الآمن
        </Link>
      </section>
    );
  }

  const chosen = selected ?? data.quotes[0]!.quoteId;

  return (
    <section className="qc" aria-label="عروض الأسعار الجاهزة">
      <h3 className="qc-title">عروضك جاهزة — اختر الأنسب لك</h3>
      {data.explanationAr ? (
        <p className="qc-why">💡 {data.explanationAr}</p>
      ) : null}
      {data.missingMarkets?.length ? (
        <p className="qc-why" role="status">
          لم يكتمل عرض مؤهل بعد في:{' '}
          {data.missingMarkets.map((market) => MARKET_AR[market]).join('، ')}.
        </p>
      ) : null}

      <div className="qc-cards" role="radiogroup">
        {data.quotes.map((q) => {
          const isSel = q.quoteId === chosen;
          const best = q.labels.includes('BEST_OVERALL');
          return (
            <label
              key={q.quoteId}
              className={`qc-card ${isSel ? 'sel' : ''} ${best ? 'best' : ''}`}
            >
              <input
                type="radio"
                name="qc-choice"
                checked={isSel}
                onChange={() => setSelected(q.quoteId)}
              />
              {best ? <span className="qc-badge">أفضل قيمة</span> : null}
              <div className="qc-price mono">
                {Number(q.finalPrice).toFixed(0)} <small>ر.س</small>
              </div>
              <div className="qc-src">{MARKET_AR[q.market]}</div>
              <ul className="qc-meta">
                <li>
                  🚚 يصل خلال{' '}
                  {q.deliveryDaysMax
                    ? `${q.deliveryDaysMin && q.deliveryDaysMin !== q.deliveryDaysMax ? `${q.deliveryDaysMin}–` : ''}${q.deliveryDaysMax} يوم`
                    : '—'}
                </li>
                <li>🛡️ ضمان {q.warrantyMonths ?? 0} شهر</li>
                {q.fitmentConfidence != null ? (
                  <li className="qc-fit">
                    ✓ توافق {Math.round(q.fitmentConfidence * 100)}%
                  </li>
                ) : null}
              </ul>
              <div className="qc-tags">
                {q.labels
                  .filter((l) => l !== 'BEST_OVERALL')
                  .map((l) => (
                    <span key={l}>{LABEL_AR[l] ?? l}</span>
                  ))}
              </div>
            </label>
          );
        })}
      </div>

      <form action={action} className="qc-approve">
        <input type="hidden" name="code" value={code} />
        <input type="hidden" name="quoteId" value={chosen} />
        {state.error ? (
          <p className="error" role="alert">
            {state.error}
          </p>
        ) : null}
        <button type="submit" disabled={pending} className="qc-cta">
          {pending ? 'جارٍ الاعتماد…' : 'اعتماد العرض والمتابعة ✓'}
        </button>
      </form>

      <details className="qc-how">
        <summary>كيف تحقّق رفرف من التوافق؟</summary>
        <ol>
          <li>✓ رقم الهيكل VIN أو بيانات المركبة</li>
          <li>✓ مطابقة كتالوج القطع ورقم OEM</li>
          <li>✓ مورد موثق ومعتمد</li>
          <li>✓ فحص وتوثيق قبل الشحن</li>
        </ol>
      </details>
      <p className="qc-note">
        السعر نهائي واصل — يشمل القطعة والشحن والضريبة. القطع الحساسة تمر
        بمراجعة فنية قبل التنفيذ.
      </p>
    </section>
  );
}
