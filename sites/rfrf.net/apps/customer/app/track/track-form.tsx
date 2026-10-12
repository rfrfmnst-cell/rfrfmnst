'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowUpLeft,
  CalendarDays,
  CircleCheckBig,
  ClipboardCheck,
  Hash,
  MessageCircle,
  Search,
  ShieldCheck,
  Clock3,
} from 'lucide-react';
import {
  cancelCustomerAwaitingPaymentOrder,
  trackRequest,
  type TrackState,
} from '../actions';
import { PaymentButton } from './payment-button';
import { QuoteCards } from './quote-cards';
import { trackCodeInputError } from './track-validation';

const initial: TrackState = {};

export function TrackForm({
  initialCode = '',
  paymentReturn = false,
}: {
  initialCode?: string;
  paymentReturn?: boolean;
}) {
  const [state, action, pending] = useActionState(trackRequest, initial);
  // القيم المُرسلة فعلاً (values تعود مع الأخطاء فقط) — لتغذية بطاقات العروض
  const sentRef = useRef<{ code: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const autoSubmitted = useRef(false);
  const [clientError, setClientError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialCode || autoSubmitted.current) return;
    autoSubmitted.current = true;
    formRef.current?.requestSubmit();
  }, [initialCode]);

  return (
    <div className="track-workspace">
      {paymentReturn ? (
        <p className="hint" role="status">
          تمت العودة من صفحة الدفع. نعرض حالة EdfaPay المؤكدة فقط؛ وقد يستغرق
          وصول التأكيد لحظات.
        </p>
      ) : null}
      <form
        ref={formRef}
        action={action}
        className="track-form"
        noValidate
        onSubmit={(e) => {
          const f = e.currentTarget;
          const codeInput = f.elements.namedItem('code') as HTMLInputElement;
          const validationError = trackCodeInputError(codeInput.value);
          setClientError(validationError);
          if (validationError) {
            e.preventDefault();
            codeRef.current?.focus();
            return;
          }
          sentRef.current = {
            code: codeInput.value.trim().toUpperCase(),
          };
        }}
      >
        <div className="grid2">
          <label className="track-field track-code-only">
            <span>رقم الطلب</span>
            <div>
              <Hash size={18} aria-hidden />
              <input
                ref={codeRef}
                id="track-code"
                name="code"
                required
                aria-invalid={clientError ? 'true' : undefined}
                aria-describedby={clientError ? 'track-code-error' : undefined}
                dir="ltr"
                maxLength={36}
                placeholder="RFQ-2607-12345 أو ORD-ABC123-456"
                defaultValue={state.values?.code ?? initialCode}
                onChange={() => {
                  if (clientError) setClientError(null);
                }}
              />
            </div>
          </label>
        </div>

        {clientError ? (
          <p id="track-code-error" className="error" role="alert">
            <AlertCircle size={17} aria-hidden /> {clientError}
          </p>
        ) : null}

        {state.error ? (
          <p className="error" role="alert">
            <AlertCircle size={17} aria-hidden /> {state.error}
            {state.authRequired ? (
              <Link href="/login">تسجيل الدخول</Link>
            ) : null}
          </p>
        ) : null}

        <button type="submit" disabled={pending}>
          <Search size={18} aria-hidden />
          {pending ? 'جارٍ البحث…' : 'تتبع الطلب'}
        </button>
        <p className="hint">
          نعرض فقط الطلبات المرتبطة بحسابك الموثق — حمايةً لخصوصيتك.
        </p>
      </form>

      {state.result ? (
        <section className="track-result customer-dashboard" aria-live="polite">
          <div className="customer-dashboard-head">
            <div>
              <p className="customer-dashboard-kicker">
                <ClipboardCheck size={16} aria-hidden /> لوحة متابعة العميل
              </p>
              <h2>{state.result.partText ?? 'طلبك لدى رفرف'}</h2>
              <p>
                كل ما تحتاجه عن طلبك في مكان واحد — بلا تفاصيل موردين أو رسوم
                خفية.
              </p>
            </div>
            <span className="customer-live">
              <span /> متابعة آمنة ومحدّثة
            </span>
          </div>

          <div className="customer-status-grid" aria-label="ملخص طلب العميل">
            <article>
              <Hash size={18} aria-hidden />
              <small>رقم الطلب</small>
              <strong className="mono" dir="ltr">
                {state.result.code}
              </strong>
            </article>
            <article>
              <CircleCheckBig size={18} aria-hidden />
              <small>الحالة الحالية</small>
              <strong>{state.result.statusAr}</strong>
            </article>
            <article>
              <CalendarDays size={18} aria-hidden />
              <small>آخر خطوة</small>
              <strong>
                {state.result.timeline.at(-1)?.date ?? state.result.createdAt}
              </strong>
            </article>
            <article
              className={state.result.finalPrice ? 'customer-price-card' : ''}
            >
              <ShieldCheck size={18} aria-hidden />
              <small>
                {state.result.finalPrice ? 'الإجمالي الواصل' : 'حماية رفرف'}
              </small>
              <strong>{state.result.finalPrice ?? 'خصوصية مضمونة'}</strong>
            </article>
          </div>

          <div className="customer-dashboard-grid">
            <div className="customer-timeline-panel">
              <div className="customer-panel-head">
                <div>
                  <p>سير الطلب</p>
                  <h3>رحلة قطعتك</h3>
                </div>
                <span>{state.result.timeline.length} مراحل مسجّلة</span>
              </div>
              <ol className="track-timeline">
                {state.result.timeline.map((t, i) => (
                  <li key={`${t.date}-${i}`}>
                    <span
                      className={`track-dot${i === state.result!.timeline.length - 1 ? ' active' : ''}`}
                    >
                      <CircleCheckBig size={15} aria-hidden />
                    </span>
                    <div>
                      <strong>{t.label}</strong>
                      <span className="track-time mono" dir="ltr">
                        {t.date}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <aside className="customer-next-step">
              <span className="customer-next-icon">
                <ArrowUpLeft size={18} aria-hidden />
              </span>
              <p>الخطوة التالية</p>
              <h3>
                {state.result.timeline.at(-1)?.label ?? state.result.statusAr}
              </h3>
              <span>سنحدّث هذه اللوحة عند أي انتقال في الطلب أو الشحن.</span>
              <a href="/chat">
                <MessageCircle size={17} aria-hidden /> تحتاج قطعة أخرى؟
              </a>
            </aside>
          </div>

          {state.result.payment?.kind === 'checkout' ? (
            <PaymentButton
              orderCode={state.result.payment.orderCode}
              emailRequired={state.result.payment.emailRequired}
              initialProcessing={state.result.payment.processing}
            />
          ) : state.result.payment ? (
            <section className="track-note" aria-label="حالة الدفع">
              <Clock3 size={18} aria-hidden />
              <span>
                <strong>الدفع الإلكتروني غير متاح حالياً</strong>
                {state.result.payment.processing
                  ? ' توجد عملية دفع مسجّلة قيد المعالجة؛ سنعرض نتيجتها المؤكدة عند وصولها.'
                  : ' طلبك محفوظ بهذه الحالة، ويمكنك إلغاؤه قبل بدء الدفع.'}
              </span>
              {!state.result.payment.processing ? (
                <form action={cancelCustomerAwaitingPaymentOrder}>
                  <input
                    type="hidden"
                    name="orderId"
                    value={state.result.payment.orderId}
                  />
                  <button type="submit">إلغاء الطلب</button>
                </form>
              ) : null}
            </section>
          ) : null}

          <p className="track-note">
            <ShieldCheck size={16} aria-hidden /> السعر النهائي شامل كل شيء — لا
            رسوم مفاجئة عند التسليم.
          </p>

          {sentRef.current?.code.startsWith('RFQ-') ? (
            <QuoteCards code={sentRef.current.code} />
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
