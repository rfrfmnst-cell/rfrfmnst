import type { Metadata } from 'next';
import { authenticationCoreConfigured } from '../../lib/auth-configuration';
import { supplierOtpSecurityConfigured } from '../../lib/supplier-otp-delivery';
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
  const phoneAvailable =
    authenticationCoreConfigured() && supplierOtpSecurityConfigured();
  const effectiveError = err ?? (!phoneAvailable ? 'unavailable' : undefined);
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
      <div className="login-wrap">
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
                pattern="[0-9٠-٩۰-۹]{6}"
                minLength={6}
                maxLength={6}
                autoComplete="one-time-code"
                aria-invalid={effectiveError === 'invalid_otp'}
                aria-describedby={
                  effectiveError === 'invalid_otp' ||
                  effectiveError === 'unavailable'
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

          {effectiveError === 'invalid_otp' && (
            <p id="supplier-otp-error" className="login-err" role="alert">
              الرمز غير صحيح أو منتهي الصلاحية.
            </p>
          )}
          {effectiveError === 'unavailable' && (
            <p id="supplier-otp-error" className="login-err" role="alert">
              تعذر التحقق من الرمز الآن. حاول مرة أخرى، أو ارجع واطلب رمزًا
              جديدًا.
            </p>
          )}

          <SubmitButton disabled={!phoneAvailable} pendingLabel="جارٍ التحقق…">
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
      </div>
    );
  }

  return (
    <div className="login-wrap">
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
              autoComplete="tel"
              inputMode="tel"
              maxLength={40}
              required
              autoFocus
              dir="ltr"
            />
          </div>
        </label>
        {effectiveError === 'invalid_phone' && (
          <p className="login-err">
            أدخل رقم جوال سعودي يبدأ بـ 05، أو رقمًا دوليًا يبدأ بعلامة + ورمز
            الدولة.
          </p>
        )}
        {effectiveError === 'rate_limited' && (
          <p className="login-err">
            محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.
          </p>
        )}
        {effectiveError === 'delivery' && (
          <p className="login-err">تعذر إرسال رمز التحقق. حاول لاحقًا.</p>
        )}
        {effectiveError === 'verification_failed' && (
          <p className="login-err">
            تعذّر إكمال التحقق البشري. حدّث الصفحة وحاول مرة أخرى.
          </p>
        )}
        {effectiveError === 'not_allowed' && (
          <p className="login-err" role="alert">
            تعذر الدخول بهذا الرقم. استخدم رقم حساب المورد المعتمد، أو{' '}
            <a
              href="https://wa.me/966500894003"
              target="_blank"
              rel="noopener noreferrer"
            >
              تواصل مع دعم رفرف
            </a>
            .
          </p>
        )}
        {effectiveError === 'unavailable' && (
          <p className="login-err" role="alert">
            خدمة الدخول غير متاحة مؤقتًا. حاول لاحقًا أو تواصل مع دعم رفرف.
          </p>
        )}
        {['expired', 'locked', 'used'].includes(effectiveError ?? '') && (
          <p className="login-err" role="alert">
            انتهت جلسة التحقق أو تعذر بدءها. اطلب رمزًا جديدًا.
          </p>
        )}
        <HumanVerificationSubmit
          disabled={!phoneAvailable}
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
          منشأة جديدة؟ <Link href="/login?mode=register">إنشاء حساب مورد</Link>.
        </p>
      </form>
    </div>
  );
}
