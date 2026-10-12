import type { Metadata } from 'next';
import { turnstileSiteKey } from '@rafraf/shared/security/turnstile';
import { cookies } from 'next/headers';
import { LogIn, Phone, ShieldCheck, KeyRound, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import {
  SUPPLIER_OTP_COOKIE,
  maskSupplierPhone,
  parseSupplierOtpChallenge,
} from '../../lib/supplier-otp';
import {
  SUPPLIER_REGISTRATION_COOKIE,
  parseSupplierRegistrationDraft,
} from '../../lib/supplier-registration-draft';
import { BrandLogo } from '@rafraf/ui/brand-logo';
import { SubmitButton } from '@rafraf/ui/submit-button';
import { requestOtp, verifyOtp } from './actions';
import { HumanVerificationSubmit } from '@rafraf/ui/human-verification-submit';

export const metadata: Metadata = {
  title: 'دخول بوابة الموردين — رفرف',
  robots: { index: false, follow: false },
};

export default async function PhoneLoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    err?: string;
    step?: string;
    registered?: string;
    registration?: string;
  }>;
}) {
  const { err, step, registered, registration } = await searchParams;
  const cookieStore = await cookies();
  const challenge = parseSupplierOtpChallenge(
    cookieStore.get(SUPPLIER_OTP_COOKIE)?.value,
  );
  const registrationDraft = parseSupplierRegistrationDraft(
    cookieStore.get(SUPPLIER_REGISTRATION_COOKIE)?.value,
  );
  const isRegistrationVerification = Boolean(
    registration === '1' ||
    (challenge && registrationDraft?.phone === challenge.phone),
  );
  const verifySessionExpired = step === 'verify' && !challenge;

  if (step === 'verify' && challenge) {
    return (
      <main className="login-wrap">
        <form action={verifyOtp} className="login-card">
          {isRegistrationVerification && (
            <input type="hidden" name="registration" value="1" />
          )}
          <BrandLogo className="login-logo" />
          <p className="login-kicker">
            {isRegistrationVerification ? 'توثيق المنشأة' : 'التحقق بخطوتين'}
          </p>
          <h1>
            {isRegistrationVerification ? 'أثبت ملكية الجوال' : 'أدخل الرمز'}
          </h1>
          <p className="login-sub">
            أرسلنا رمز تحقق (OTP) عبر قناة آمنة إلى الرقم{' '}
            <span dir="ltr">{maskSupplierPhone(challenge.phone)}</span>. إذا لم
            يصل الرمز، ارجع وأعد المحاولة لاحقًا.
            {isRegistrationVerification
              ? ' لن تُنشأ المنشأة قبل نجاح هذا التحقق.'
              : ''}
          </p>

          <label>
            <span>رمز التحقق (6 أرقام)</span>
            <div dir="ltr">
              <KeyRound size={18} aria-hidden />
              <input
                className="login-code-input"
                name="code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                autoComplete="one-time-code"
                aria-invalid={err === 'invalid_otp'}
                aria-describedby={
                  err === 'invalid_otp' || err === 'unavailable'
                    ? 'supplier-otp-error'
                    : undefined
                }
                placeholder="••••••"
                required
                autoFocus
                dir="ltr"
              />
            </div>
          </label>

          {err === 'invalid_otp' && (
            <p id="supplier-otp-error" className="login-err" role="alert">
              الرمز غير صحيح أو منتهي الصلاحية.
            </p>
          )}
          {err === 'unavailable' && (
            <p id="supplier-otp-error" className="login-err" role="alert">
              تعذر التحقق من الرمز الآن. حاول مرة أخرى، أو ارجع واطلب رمزًا
              جديدًا.
            </p>
          )}

          <SubmitButton pendingLabel="جارٍ التحقق…">
            تأكيد الدخول <LogIn size={18} aria-hidden />
          </SubmitButton>

          <p className="sp-note login-back">
            <Link
              href={
                isRegistrationVerification
                  ? '/?register=1'
                  : '/login?mode=phone'
              }
            >
              <ArrowRight size={14} /> العودة وتعديل الرقم
            </Link>
          </p>
        </form>
      </main>
    );
  }

  return (
    <main className="login-wrap">
      <form action={requestOtp} className="login-card">
        {(registrationDraft || registration === '1') && (
          <input type="hidden" name="registration" value="1" />
        )}
        <BrandLogo className="login-logo" />
        <p className="login-kicker">بوابة الموردين</p>
        <h1>{registrationDraft ? 'أكمل تسجيل منشأتك' : 'مرحباً بعودتك'}</h1>
        <p className="login-sub">
          {registrationDraft
            ? 'بيانات منشأتك محفوظة مؤقتًا. اطلب رمزًا جديدًا للجوال نفسه لإكمال التسجيل.'
            : 'أدخل رقم جوال المنشأة. سيصل رمز آمن للتحقق من ملكية الرقم قبل فحص أهلية الحساب.'}
        </p>
        {registered === '1' && (
          <p className="sp-alert ok" role="status">
            تم استلام التسجيل. أدخل الجوال نفسه لإثبات ملكيته وفتح حالة الطلب.
          </p>
        )}
        {verifySessionExpired && (
          <p className="sp-alert err" role="alert">
            انتهت جلسة التحقق. اطلب رمزًا جديدًا للمتابعة.
          </p>
        )}
        <label>
          <span>رقم الجوال الدولي</span>
          <div dir="ltr">
            <Phone size={18} aria-hidden />
            <input
              name="phone"
              type="tel"
              defaultValue={registrationDraft?.phone}
              readOnly={Boolean(registrationDraft)}
              placeholder="+966512345678"
              pattern="(?:\+[1-9][0-9]{7,14}|05[0-9]{8})"
              required
              autoFocus
              dir="ltr"
            />
          </div>
        </label>
        {err === 'invalid_phone' && (
          <p className="login-err">
            أدخل رقم جوال دوليًا صحيحًا يبدأ بعلامة + ورمز الدولة.
          </p>
        )}
        {err === 'rate_limited' && (
          <p className="login-err">
            محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.
          </p>
        )}
        {err === 'delivery' && (
          <p className="login-err">تعذر إرسال رمز التحقق. حاول لاحقًا.</p>
        )}
        {err === 'verification_failed' && (
          <p className="login-err">
            تعذّر إكمال التحقق البشري. حدّث الصفحة وحاول مرة أخرى.
          </p>
        )}
        {['unavailable', 'expired', 'locked', 'used', 'not_allowed'].includes(
          err ?? '',
        ) && (
          <p className="login-err" role="alert">
            انتهت جلسة التحقق أو تعذر بدءها. اطلب رمزًا جديدًا.
          </p>
        )}
        <HumanVerificationSubmit
          siteKey={turnstileSiteKey() ?? ''}
          action="supplier_otp"
          label={registrationDraft ? 'إرسال رمز جديد' : 'دخول'}
          turnstileClassName="login-turnstile"
        />
        <div className="login-security">
          <ShieldCheck size={16} aria-hidden />
          <span>تشفير وحماية البيانات</span>
        </div>
        <p className="sp-note login-back">
          للتسجيل كمنشأة جديدة، <Link href="/?register=1">انقر هنا</Link>.
        </p>
      </form>
    </main>
  );
}
