import type { Metadata } from 'next';
import { KeyRound, LockKeyhole, LogIn, ShieldCheck } from 'lucide-react';
import { BrandLogo } from '@rafraf/ui/brand-logo';

const LOGIN_ERRORS: Record<string, string> = {
  invalid: 'بيانات الدخول غير صحيحة أو لا تملك صلاحية الدخول.',
  invalid_otp: 'رمز التحقق غير صحيح. تحقق من الرمز وأعد المحاولة.',
  rate: 'محاولات كثيرة. انتظر 15 دقيقة ثم أعد المحاولة.',
  locked: 'تم قفل تحدّي التحقق. ابدأ تسجيل الدخول من جديد.',
  expired: 'انتهت صلاحية تحدّي التحقق. ابدأ تسجيل الدخول من جديد.',
  unavailable: 'خدمة الدخول غير متاحة مؤقتًا. تحقق من اتصال قاعدة البيانات.',
};

export const metadata: Metadata = {
  title: 'دخول مركز العمليات — رفرف',
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; step?: string }>;
}) {
  const { e, step } = await searchParams;
  const verify = step === 'verify';

  return (
    <main className="login-wrap">
      <form
        method="POST"
        action={verify ? '/login/verify' : '/login/submit'}
        className="login-card"
      >
        <BrandLogo className="login-logo" />
        <p className="login-kicker">مركز عمليات رفرف</p>
        <h1>{verify ? 'تحقق ثانٍ مطلوب' : 'دخول فريق العمليات'}</h1>
        <p className="login-sub">
          {verify
            ? 'أدخل رمز التحقق المرسل إلى وسيلة المصادقة المسجلة لحسابك.'
            : 'مساحة محمية لمراجعة القرارات وإدارة الطلبات والعروض.'}
        </p>

        {verify ? (
          <label>
            <span>رمز التحقق</span>
            <div>
              <KeyRound size={18} aria-hidden />
              <input
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                required
                autoFocus
                autoComplete="one-time-code"
              />
            </div>
          </label>
        ) : (
          <>
            <label>
              <span>البريد الإلكتروني أو رقم الجوال</span>
              <div>
                <KeyRound size={18} aria-hidden />
                <input
                  name="identifier"
                  required
                  autoFocus
                  autoComplete="username"
                />
              </div>
            </label>
            <label>
              <span>كلمة المرور</span>
              <div>
                <LockKeyhole size={18} aria-hidden />
                <input
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </div>
            </label>
          </>
        )}

        {e ? (
          <p className="login-err" role="alert">
            {LOGIN_ERRORS[e] ?? LOGIN_ERRORS.invalid}
          </p>
        ) : null}
        <button type="submit">
          <LogIn size={18} aria-hidden />{' '}
          {verify ? 'تحقق ودخول' : 'متابعة آمنة'}
        </button>
        {verify ? (
          <p className="login-sub">
            <a href="/login">بدء تسجيل الدخول من جديد</a>
          </p>
        ) : null}
        <p className="login-security">
          <ShieldCheck size={15} aria-hidden /> الوصول والصلاحيات مسجلان في سجل
          التدقيق
        </p>
      </form>
    </main>
  );
}
