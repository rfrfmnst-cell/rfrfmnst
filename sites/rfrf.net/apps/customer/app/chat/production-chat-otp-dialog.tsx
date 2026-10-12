'use client';

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { ShieldCheck } from 'lucide-react';
import { TurnstileWidget } from '@rafraf/ui/turnstile-widget';

export function OtpDialog({
  turnstileSiteKey,
  onClose,
  onVerified,
  onRegistrationRequired,
  initialPhone = '',
  lockPhone = false,
  purpose = 'chat',
}: {
  turnstileSiteKey: string;
  onClose: () => void;
  onVerified: () => Promise<void>;
  onRegistrationRequired?: () => boolean;
  initialPhone?: string;
  lockPhone?: boolean;
  purpose?: 'chat' | 'rfq';
}) {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState(initialPhone);
  const [code, setCode] = useState('');
  const [developmentCode, setDevelopmentCode] = useState('');
  const [masked, setMasked] = useState('');
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileAttempt, setTurnstileAttempt] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    inputRef.current?.focus();
    return () => returnFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, [step]);

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  async function requestOtp(event: FormEvent) {
    event.preventDefault();
    if (!turnstileToken) {
      setError('أكمل التحقق البشري قبل طلب الرمز.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/customer/otp/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone, turnstileToken }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        maskedPhone?: string;
        developmentCode?: string;
        error?: string;
      };
      if (!response.ok) {
        setError(
          response.status === 429
            ? 'طلبات كثيرة. انتظر قليلاً ثم حاول.'
            : response.status === 403 || body.error === 'verification_failed'
              ? 'تعذّر التحقق البشري. أعد إكمال التحدي وحاول.'
              : 'تعذّر إرسال الرمز. تأكد من رقم الجوال.',
        );
        setTurnstileToken('');
        setTurnstileAttempt((attempt) => attempt + 1);
        return;
      }
      setMasked(body.maskedPhone ?? 'جوالك');
      setDevelopmentCode(body.developmentCode ?? '');
      setStep('code');
    } catch {
      setError('تعذّر الاتصال بخدمة التحقق. تحقق من اتصالك ثم حاول.');
      setTurnstileToken('');
      setTurnstileAttempt((attempt) => attempt + 1);
    } finally {
      setBusy(false);
    }
  }

  async function finishVerifiedSession() {
    setBusy(true);
    setError('');
    try {
      await onVerified();
    } catch {
      setVerified(true);
      setError(
        purpose === 'rfq'
          ? 'تم توثيق جوالك، لكن تعذّر إرسال الطلب. أعد المحاولة دون طلب رمز جديد.'
          : 'تم توثيق جوالك، لكن تعذّر فتح المحادثة. أعد المحاولة دون طلب رمز جديد.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    let sessionVerified = false;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/customer/otp/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        registrationUrl?: string;
      };
      if (
        response.status === 409 &&
        body.error === 'registration_required' &&
        body.registrationUrl === '/login?step=register'
      ) {
        if (onRegistrationRequired && !onRegistrationRequired()) {
          setError(
            'تم توثيق الجوال، لكن تعذّر حفظ طلبك قبل إنشاء الحساب. افتح تسجيل الدخول في علامة جديدة وأكمل التسجيل.',
          );
          return;
        }
        window.location.assign(body.registrationUrl);
        return;
      }
      if (!response.ok) {
        setError(
          response.status === 410
            ? 'انتهت صلاحية الرمز. اطلب رمزاً جديداً.'
            : 'الرمز غير صحيح أو لم يعد صالحاً.',
        );
        return;
      }
      sessionVerified = true;
      setVerified(true);
      await onVerified();
    } catch {
      setError(
        sessionVerified || verified
          ? purpose === 'rfq'
            ? 'تم توثيق جوالك، لكن تعذّر إرسال الطلب. أعد المحاولة دون طلب رمز جديد.'
            : 'تم توثيق جوالك، لكن تعذّر فتح المحادثة. أعد المحاولة دون طلب رمز جديد.'
          : 'تعذّر الاتصال بخدمة التحقق. تحقق من اتصالك ثم حاول.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rf-otp-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="rf-otp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="otp-title"
        aria-describedby="otp-description"
        onKeyDown={handleDialogKeyDown}
      >
        <button
          className="rf-otp-close"
          type="button"
          onClick={onClose}
          aria-label="إغلاق"
          disabled={busy}
        >
          ×
        </button>
        <ShieldCheck size={32} />
        <h2 id="otp-title">وثّق جوالك للمتابعة</h2>
        <p id="otp-description">
          {step === 'phone'
            ? purpose === 'rfq'
              ? 'سنرسل رمز تحقق آمن إلى جوال الطلب، ثم نكمل إرساله تلقائياً.'
              : 'سنرسل رمز تحقق آمن، ثم نرسل رسالتك تلقائياً.'
            : `أدخل الرمز المرسل إلى ${masked}.`}
        </p>
        {developmentCode ? (
          <button
            className="rf-otp-development-code"
            type="button"
            onClick={() => setCode(developmentCode)}
          >
            رمز التطوير المحلي: <b dir="ltr">{developmentCode}</b>
          </button>
        ) : null}
        {step === 'phone' ? (
          <form onSubmit={requestOtp}>
            <label>
              رقم الجوال السعودي
              <input
                ref={inputRef}
                dir="ltr"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                readOnly={lockPhone}
                placeholder="05xxxxxxxx"
                required
              />
            </label>
            <TurnstileWidget
              key={turnstileAttempt}
              siteKey={turnstileSiteKey}
              action="customer_otp"
              className="rf-otp-turnstile"
              onTokenChange={setTurnstileToken}
            />
            <button disabled={busy || !turnstileToken} type="submit">
              {busy ? 'جاري الإرسال…' : 'إرسال رمز التحقق'}
            </button>
          </form>
        ) : verified ? (
          <button
            className="rf-otp-session-retry"
            disabled={busy}
            type="button"
            onClick={() => void finishVerifiedSession()}
          >
            {busy
              ? purpose === 'rfq'
                ? 'جاري إرسال الطلب…'
                : 'جاري فتح المحادثة…'
              : purpose === 'rfq'
                ? 'إعادة إرسال الطلب'
                : 'إعادة فتح المحادثة'}
          </button>
        ) : (
          <form onSubmit={verify}>
            <label>
              رمز التحقق
              <input
                ref={inputRef}
                dir="ltr"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                pattern="[0-9]{6}"
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, ''))
                }
                placeholder="000000"
                required
              />
            </label>
            <button disabled={busy || code.length !== 6} type="submit">
              {busy
                ? 'جاري التحقق…'
                : purpose === 'rfq'
                  ? 'تحقق وأرسل طلبي'
                  : 'تحقق وأرسل رسالتي'}
            </button>
          </form>
        )}
        {error ? (
          <span className="rf-otp-error" role="alert">
            {error}
          </span>
        ) : null}
        <small>
          {purpose === 'rfq'
            ? 'لن نطبع رقم جوالك أو رمزك في السجلات التشغيلية.'
            : 'لن نطبع رقم جوالك أو رمزك في سجلات الدردشة.'}
        </small>
      </section>
    </div>
  );
}
