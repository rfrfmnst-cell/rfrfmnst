import type { Metadata } from 'next';
import PhoneLoginPage from './phone-login';
import { SupplierTrialNotice } from './supplier-trial-notice';
import { turnstileSiteKey } from '@rafraf/shared/security/turnstile';
import { Building2, LogIn, Mail, ShieldCheck, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { BrandLogo } from '@rafraf/ui/brand-logo';
import { HumanVerificationSubmit } from '@rafraf/ui/human-verification-submit';
import {
  requestSupplierEmailLogin,
  requestSupplierEmailRegistration,
} from './email-actions';

export const metadata: Metadata = {
  title: 'دخول وتسجيل موردي رفرف',
  robots: { index: false, follow: false },
};

const ERROR_TEXT: Record<string, string> = {
  invalid_email: 'أدخل بريدًا إلكترونيًا صحيحًا للمنشأة.',
  invalid_registration: 'راجع بيانات المنشأة والبريد والجوال ثم حاول مجددًا.',
  registration_expired:
    'انتهت صلاحية بيانات التسجيل المحفوظة. أعد إدخال بيانات منشأتك لإكمال التسجيل.',
  verification_failed: 'تعذّر إكمال التحقق البشري. حدّث الصفحة وحاول مجددًا.',
  rate_limited: 'محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.',
  delivery: 'تعذّر إرسال رابط التحقق. حاول لاحقًا.',
  unavailable: 'خدمة الدخول بالبريد غير متاحة مؤقتًا.',
  email_verification: 'الرابط غير صالح أو منتهي أو استُخدم من قبل.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    err?: string;
    mode?: string;
    step?: string;
    registration?: string;
  }>;
}) {
  const requested = await searchParams;
  if (requested.mode === 'phone' || requested.step === 'verify')
    return PhoneLoginPage({ searchParams });
  const { err, mode, step, registration } = await searchParams;
  const registering = mode === 'register';

  if (step === 'check_email') {
    return (
      <div className="login-wrap">
        <section className="login-card" aria-live="polite">
          <BrandLogo className="login-logo" />
          <p className="login-kicker">تحقق البريد</p>
          <Mail size={36} aria-hidden />
          <h1>راجع بريدك الإلكتروني</h1>
          <p className="login-sub">
            إذا كانت البيانات مؤهلة فسيصلك رابط آمن صالح لمدة 15 دقيقة.
            {registration === '1'
              ? ' افتح الرابط من المتصفح نفسه لإكمال تسجيل المنشأة.'
              : ' افتح الرابط من المتصفح نفسه للدخول.'}
          </p>
          <p className="sp-note login-back">
            لم تصل الرسالة؟ تحقق من البريد غير المرغوب ثم{' '}
            <Link
              href={registration === '1' ? '/login?mode=register' : '/login'}
            >
              أعد المحاولة
            </Link>
            .
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <section className="login-card" aria-labelledby="supplier-login-title">
        <a className="login-home-link" href="https://rfrf.net">العودة إلى رفرف</a>
        <BrandLogo className="login-logo" />
        <p className="login-kicker">بوابة الموردين</p>
        <h1 id="supplier-login-title">
          {registering ? 'سجّل منشأتك' : 'مرحبًا بعودتك'}
        </h1>
        <p className="login-sub">
          {registering
            ? 'أنشئ حساب المورد ثم أكد بريد المنشأة من الرابط المرسل إليك.'
            : 'أدخل بريد المنشأة وسنرسل رابط دخول آمنًا بلا كلمة مرور.'}
        </p>

        <p className="sp-note">
          <Link href="/login?mode=phone">الدخول بالجوال للحسابات السابقة</Link>
        </p>
        <nav className="auth-mode-switch" aria-label="اختيار نوع العملية">
          <Link href="/login" aria-current={!registering ? 'page' : undefined}>
            <LogIn size={17} aria-hidden /> تسجيل الدخول
          </Link>
          <Link
            href="/login?mode=register"
            aria-current={registering ? 'page' : undefined}
          >
            <UserPlus size={17} aria-hidden /> تسجيل جديد
          </Link>
        </nav>

        {registering ? <SupplierTrialNotice /> : null}

        {err && (
          <p id="supplier-login-error" className="login-err" role="alert">
            {ERROR_TEXT[err] ?? ERROR_TEXT.unavailable}
          </p>
        )}

        {registering ? (
          <form action={requestSupplierEmailRegistration} className="qform">
            <label>
              <span>اسم المنشأة</span>
              <div>
                <Building2 size={18} aria-hidden />
                <input
                  name="businessName"
                  required
                  maxLength={80}
                  autoComplete="organization"
                  autoFocus
                />
              </div>
            </label>
            <label>
              <span>البريد الإلكتروني للمنشأة</span>
              <div dir="ltr">
                <Mail size={18} aria-hidden />
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  dir="ltr"
                  maxLength={254}
                  aria-invalid={
                    err === 'invalid_email' || err === 'invalid_registration'
                  }
                  aria-describedby={err ? 'supplier-login-error' : undefined}
                />
              </div>
            </label>
            <div className="qgrid">
              <label>
                المدينة (اختياري)
                <input
                  name="city"
                  maxLength={40}
                  autoComplete="address-level2"
                />
              </label>
              <label>
                رمز الدولة (حرفان)
                <input
                  name="countryCode"
                  autoComplete="country"
                  defaultValue="SA"
                  title="رمز الدولة من حرفين، مثل SA للسعودية"
                  pattern="[A-Za-z]{2}"
                  minLength={2}
                  maxLength={2}
                  required
                  dir="ltr"
                />
              </label>
              <label>
                رقم التسجيل القانوني
                <input
                  name="legalRegistrationNumber"
                  maxLength={64}
                  required
                  dir="ltr"
                />
              </label>
              <label>
                رقم الجوال
                <input
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  placeholder="+966512345678"
                  pattern="(?:[+][1-9][0-9]{7,14}|05[0-9]{8})"
                  maxLength={32}
                  required
                  dir="ltr"
                  aria-describedby="supplier-phone-hint"
                />
              </label>
            </div>
            <p id="supplier-phone-hint" className="sp-note">
              للجوال السعودي استخدم 05 أو +966. للأرقام الدولية أضف رمز الدولة.
            </p>
            <HumanVerificationSubmit
              siteKey={turnstileSiteKey() ?? ''}
              action="supplier_email_register"
              label="إرسال رابط التسجيل"
              pendingLabel="جارٍ الإرسال…"
              turnstileClassName="registration-turnstile"
              icon={<UserPlus size={17} aria-hidden />}
              iconPosition="start"
            />
          </form>
        ) : (
          <form action={requestSupplierEmailLogin} className="qform">
            <label>
              <span>البريد الإلكتروني للمنشأة</span>
              <div dir="ltr">
                <Mail size={18} aria-hidden />
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  autoFocus
                  dir="ltr"
                />
              </div>
            </label>
            <HumanVerificationSubmit
              siteKey={turnstileSiteKey() ?? ''}
              action="supplier_email_login"
              label="إرسال رابط الدخول"
              pendingLabel="جارٍ الإرسال…"
              turnstileClassName="login-turnstile"
              icon={<LogIn size={17} aria-hidden />}
              iconPosition="start"
            />
          </form>
        )}

        <div className="login-security">
          <ShieldCheck size={16} aria-hidden />
          <span>
            يمكنك الدخول من رابط البريد دون كلمة مرور. افتحه في المتصفح نفسه
            خلال 15 دقيقة.
          </span>
        </div>
      </section>
    </div>
  );
}
