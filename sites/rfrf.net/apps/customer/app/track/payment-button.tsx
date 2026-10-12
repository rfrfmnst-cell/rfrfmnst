'use client';

import { CreditCard, Mail, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import styles from './payment-button.module.css';

type CheckoutPayload = { redirectUrl?: unknown; error?: unknown };

export function PaymentButton({
  orderCode,
  emailRequired,
  initialProcessing,
}: {
  orderCode: string;
  emailRequired: boolean;
  initialProcessing: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [needsEmail, setNeedsEmail] = useState(false);
  const [processing, setProcessing] = useState(initialProcessing);
  const [loginRequired, setLoginRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (emailRequired || needsEmail) {
    return (
      <section className={styles.card} aria-label="بيانات الدفع المطلوبة">
        <Mail size={23} aria-hidden />
        <div>
          <h3>أضف بريد إيصال الدفع</h3>
          <p>المزوّد يشترط بريداً صحيحاً قبل فتح صفحة الدفع المستضافة.</p>
          <Link href="/account#profile">إكمال بيانات العميل</Link>
        </div>
      </section>
    );
  }

  if (processing) {
    return (
      <section className={styles.card} aria-live="polite">
        <ShieldCheck size={23} aria-hidden />
        <div>
          <h3>دفعتك قيد المعالجة</h3>
          <p>لن نفتح دفعة ثانية. حدّث التتبع بعد وصول تأكيد المزوّد.</p>
        </div>
      </section>
    );
  }

  async function startCheckout() {
    setPending(true);
    setError(null);
    setLoginRequired(false);
    try {
      const response = await fetch('/api/payments/edfapay/checkout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ orderCode }),
      });
      const payload = (await response
        .json()
        .catch(() => ({}))) as CheckoutPayload;
      if (!response.ok) {
        if (payload.error === 'email_required') {
          setNeedsEmail(true);
          return;
        }
        if (payload.error === 'already_paid') {
          setProcessing(true);
          return;
        }
        if (payload.error === 'unauthorized') setLoginRequired(true);
        setError(
          payload.error === 'order_not_payable'
            ? 'هذا الطلب غير متاح للدفع في حالته الحالية.'
            : payload.error === 'shipping_address_required'
              ? 'أضف عنوان شحن افتراضياً من حسابك قبل إكمال الدفع.'
              : payload.error === 'payment_unavailable'
                ? 'الدفع الإلكتروني غير متاح مؤقتاً. حاول بعد قليل.'
                : 'تعذّر بدء الدفع بأمان. حاول مرة أخرى.',
        );
        return;
      }

      if (typeof payload.redirectUrl !== 'string') {
        throw new Error('checkout_redirect_missing');
      }
      const target = new URL(payload.redirectUrl);
      if (target.protocol !== 'https:') {
        throw new Error('checkout_redirect_insecure');
      }
      window.location.assign(target.toString());
    } catch {
      setError('تعذّر الاتصال بمزوّد الدفع. حاول مرة أخرى.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.card} aria-label="الدفع الإلكتروني">
      <ShieldCheck size={23} aria-hidden />
      <div className={styles.body}>
        <h3>أكمل الدفع الآمن</h3>
        <p>
          ستنتقل إلى صفحة EdfaPay المستضافة؛ رفرف لا يطّلع على بيانات بطاقتك.
        </p>
        {error ? (
          <p className={styles.error} role="alert">
            {error}{' '}
            {loginRequired ? <Link href="/login">تسجيل الدخول</Link> : null}
          </p>
        ) : null}
        <button type="button" onClick={startCheckout} disabled={pending}>
          <CreditCard size={18} aria-hidden />
          {pending ? 'جارٍ فتح الدفع…' : 'الدفع الآن'}
        </button>
      </div>
    </section>
  );
}
