'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { submitRfq, type RfqFormState } from './actions';
import { TurnstileWidget } from '@rafraf/ui/turnstile-widget';
import { OtpDialog } from './chat/production-chat-otp-dialog';

const initial: RfqFormState = {};

export function RfqForm({ turnstileSiteKey }: { turnstileSiteKey: string }) {
  const [state, action, pending] = useActionState(submitRfq, initial);
  const [otpOpen, setOtpOpen] = useState(false);
  const [verifiedResubmit, setVerifiedResubmit] = useState(false);
  const [turnstileAttempt, setTurnstileAttempt] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState('');
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.verificationRequired) setOtpOpen(true);
  }, [state.verificationRequired]);

  useEffect(() => {
    if (!verifiedResubmit || !turnstileToken || pending) return;
    setVerifiedResubmit(false);
    formRef.current?.requestSubmit();
  }, [pending, turnstileToken, verifiedResubmit]);

  if (state.ok && state.code) {
    return (
      <div className="card success" role="status">
        <h3>وصلنا طلبك ✓</h3>
        <p>
          رقم الطلب: <strong dir="ltr">{state.code}</strong>
        </p>
        <p>سنقارن العروض محلياً ودولياً ونعود إليك على جوالك بأفضل الخيارات.</p>
      </div>
    );
  }

  return (
    <>
      <form ref={formRef} action={action} className="card form">
        <h3>اطلب قطعتك الآن</h3>

        <div className="grid2">
          <label>
            الاسم
            <input
              name="fullName"
              required
              maxLength={80}
              placeholder="مثال: أحمد الحربي"
              defaultValue={state.values?.fullName}
            />
          </label>
          <label>
            الجوال
            <input
              name="phone"
              required
              inputMode="tel"
              dir="ltr"
              placeholder="05xxxxxxxx"
              pattern="^(\+9665|05|9665)[0-9]{8}$"
              defaultValue={state.values?.phone}
            />
          </label>
        </div>

        <div className="grid3">
          <label>
            الماركة
            <input
              name="make"
              placeholder="تويوتا"
              maxLength={40}
              defaultValue={state.values?.make}
            />
          </label>
          <label>
            الموديل
            <input
              name="model"
              placeholder="كامري"
              maxLength={40}
              defaultValue={state.values?.model}
            />
          </label>
          <label>
            السنة
            <input
              name="year"
              inputMode="numeric"
              dir="ltr"
              placeholder="2021"
              maxLength={4}
              defaultValue={state.values?.year}
            />
          </label>
        </div>

        <label>
          القطعة المطلوبة
          <textarea
            name="partText"
            required
            maxLength={500}
            rows={3}
            placeholder="مثال: فحمات فرامل أمامية أصلية"
            defaultValue={state.values?.partText}
          />
        </label>

        <div className="grid2">
          <label>
            رقم القطعة OEM (اختياري)
            <input
              name="oemNumber"
              dir="ltr"
              maxLength={40}
              placeholder="04465-06220"
              defaultValue={state.values?.oemNumber}
            />
          </label>
          <label>
            رقم الهيكل VIN (اختياري)
            <input
              name="vin"
              dir="ltr"
              maxLength={17}
              placeholder="JTNB11HK…"
              defaultValue={state.values?.vin}
            />
          </label>
        </div>

        <label>
          ملاحظات (اختياري)
          <input
            name="notes"
            maxLength={200}
            placeholder="أي تفاصيل تهمّنا"
            defaultValue={state.values?.notes}
          />
        </label>

        {state.error ? (
          <p className="error" role="alert">
            {state.error}
          </p>
        ) : null}

        {state.verificationRequired && !verifiedResubmit ? (
          <button type="button" onClick={() => setOtpOpen(true)}>
            وثّق الجوال وأكمل الطلب
          </button>
        ) : null}

        {verifiedResubmit ? (
          <p className="hint" role="status">
            تم توثيق الجوال. نجهّز تحققًا بشريًا جديدًا لإرسال الطلب بأمان…
          </p>
        ) : null}

        <TurnstileWidget
          key={turnstileAttempt}
          siteKey={turnstileSiteKey}
          action="public_intake"
          onTokenChange={setTurnstileToken}
        />

        <button type="submit" disabled={pending}>
          {pending ? 'جارٍ الإرسال…' : 'أرسل الطلب'}
        </button>
        <p className="hint">
          بإرسالك الطلب توافق على تواصلنا معك على جوالك بخصوصه.
        </p>
      </form>
      {otpOpen ? (
        <OtpDialog
          turnstileSiteKey={turnstileSiteKey}
          initialPhone={state.values?.phone ?? ''}
          lockPhone
          purpose="rfq"
          onClose={() => setOtpOpen(false)}
          onVerified={async () => {
            setOtpOpen(false);
            setTurnstileToken('');
            setVerifiedResubmit(true);
            setTurnstileAttempt((attempt) => attempt + 1);
          }}
        />
      ) : null}
    </>
  );
}
