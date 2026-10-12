import type { Metadata } from 'next';
import { turnstileSiteKey } from '@rafraf/shared/security/turnstile';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  KeyRound,
  LockKeyhole,
  LogIn,
  Mail,
  Phone,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import {
  CUSTOMER_OTP_COOKIE,
  maskCustomerPhone,
  parseCustomerOtpChallenge,
} from '../../lib/customer-otp';
import {
  CUSTOMER_REGISTRATION_COOKIE,
  parseCustomerRegistrationProof,
} from '../../lib/customer-registration-proof';
import { googleOAuthConfiguration } from '../../lib/customer-google-oauth';
import { SubmitButton } from '@rafraf/ui/submit-button';
import {
  registerCustomer,
  requestCustomerOtp,
  signInCustomerPassword,
  verifyCustomerOtp,
} from './actions';
import { HumanVerificationSubmit } from '@rafraf/ui/human-verification-submit';
import {
  AuthHeader,
  AuthBackLink,
  AuthReturnField,
  AuthModeTabs,
  GoogleButton,
  MethodTabs,
} from './auth-components';
import styles from './login.module.css';
import { PasswordInput } from './password-input';
import { getSessionCustomerId } from '../../lib/session';
import { safePostAuthPath } from '../../lib/customer-auth-return-path';
import type { CustomerLoginSearchParams } from './auth-navigation';

export const metadata: Metadata = {
  title: 'الدخول وإنشاء الحساب — رفرف',
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid_phone: 'أدخل رقم جوال سعودي صالحًا، مثل 05xxxxxxxx.',
  rate_limited: 'تمت محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.',
  delivery: 'تعذر إرسال رمز التحقق الآن. تحقق من الرقم وحاول لاحقًا.',
  expired: 'انتهت جلسة التحقق. ابدأ المحاولة من جديد.',
  locked: 'تجاوزت محاولات التحقق المسموحة. اطلب رمزًا جديدًا.',
  invalid_otp: 'الرمز غير صحيح أو منتهي الصلاحية.',
  not_allowed: 'تعذر إكمال تسجيل الدخول بهذا الرقم.',
  invalid: 'بيانات الدخول غير صحيحة أو الحساب غير جاهز للدخول.',
  invalid_registration:
    'تحقق من الاسم والبريد، واستخدم كلمة مرور من 12 خانة تتضمن حرفًا ورقمًا.',
  google_failed: 'تعذر إكمال الدخول عبر Google. حاول مرة أخرى.',
  google_unavailable: 'الدخول عبر Google غير متاح مؤقتًا.',
  email_verification:
    'رابط التحقق غير صالح أو فُتح في متصفح مختلف. ابدأ التسجيل من جديد.',
  email_verification_unavailable:
    'تعذر التحقق من بريدك مؤقتًا. أعد فتح رابط التحقق من الرسالة في هذا المتصفح بعد قليل.',
  unavailable: 'خدمة تسجيل الدخول غير متاحة مؤقتًا. حاول لاحقًا.',
  verification_failed: 'تعذّر إكمال التحقق البشري. حدّث الصفحة وحاول مرة أخرى.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<CustomerLoginSearchParams>;
}) {
  const { err, method, step, next: requestedNext } = await searchParams;
  const next = requestedNext ? safePostAuthPath(requestedNext) : undefined;
  let customerId: string | null = null;
  let sessionUnavailable = false;
  try {
    customerId = await getSessionCustomerId();
  } catch {
    sessionUnavailable = true;
  }
  if (customerId) redirect(safePostAuthPath(next));
  const cookieStore = await cookies();
  const challenge =
    step === 'verify'
      ? parseCustomerOtpChallenge(cookieStore.get(CUSTOMER_OTP_COOKIE)?.value)
      : null;
  const registrationProof =
    step === 'register'
      ? parseCustomerRegistrationProof(
          cookieStore.get(CUSTOMER_REGISTRATION_COOKIE)?.value,
        )
      : null;
  const effectiveError =
    step === 'verify' && !challenge
      ? 'expired'
      : (err ?? (sessionUnavailable ? 'unavailable' : undefined));
  const siteKey = turnstileSiteKey() ?? '';
  const googleAvailable = googleOAuthConfiguration() !== null;
  const loginMethod =
    method === 'phone' || step === 'verify' ? 'phone' : 'email';
  const registerMethod = method === 'phone' ? 'phone' : 'email';

  if (challenge) {
    return (
      <main className={styles.page}>
        <form
          action={verifyCustomerOtp}
          className={styles.card}
          aria-labelledby="otp-title"
        >
          <AuthReturnField next={next} />
          <AuthHeader kicker="دخول آمن" />
          <h1 id="otp-title" className={styles.title}>
            أدخل رمز التحقق
          </h1>
          <p className={styles.description}>
            أرسلنا رمزًا من 6 أرقام إلى{' '}
            <bdi dir="ltr">{maskCustomerPhone(challenge.phone)}</bdi>. تنتهي
            صلاحيته خلال خمس دقائق.
          </p>
          {effectiveError && (
            <p id="otp-error" className={styles.error} role="alert">
              {ERROR_MESSAGES[effectiveError] ?? 'تعذر إكمال التحقق.'}
            </p>
          )}
          <label className={styles.field}>
            <span className={styles.labelText}>رمز التحقق</span>
            <span className={styles.inputShell} dir="ltr">
              <KeyRound size={18} aria-hidden />
              <input
                className={`${styles.input} ${styles.otpInput}`}
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
                dir="ltr"
                aria-invalid={Boolean(effectiveError)}
                aria-describedby={effectiveError ? 'otp-error' : undefined}
              />
            </span>
          </label>
          <SubmitButton className={styles.primary} pendingLabel="جارٍ التحقق…">
            تأكيد الدخول <LogIn size={18} aria-hidden />
          </SubmitButton>
          <AuthBackLink href="/login?method=phone" next={next}>
            تعديل رقم الجوال
          </AuthBackLink>
          <p className={styles.support}>
            لن يطلب منك فريق رفرف مشاركة هذا الرمز في مكالمة أو رسالة.
          </p>
        </form>
      </main>
    );
  }

  if (step === 'check_email') {
    return (
      <main className={styles.page}>
        <section className={styles.card} aria-labelledby="email-title">
          <AuthHeader kicker="تحقق البريد" />
          <h1 id="email-title" className={styles.title}>
            تحقق من بريدك الإلكتروني
          </h1>
          <p className={styles.description}>
            إذا أمكن إنشاء الحساب، أرسلنا رابطًا صالحًا لمدة 15 دقيقة. افتحه في
            هذا المتصفح نفسه لحماية حسابك.
          </p>
          <div className={styles.governance}>
            <ShieldCheck size={17} aria-hidden />
            <span>
              لم تصل الرسالة؟ تحقق من البريد غير المرغوب، ثم أعد المحاولة.
            </span>
          </div>
          <AuthBackLink href="/login" next={next}>
            العودة إلى تسجيل الدخول
          </AuthBackLink>
        </section>
      </main>
    );
  }

  if (step === 'register') {
    const googleProof = registrationProof?.provider === 'google';
    return (
      <main className={styles.page}>
        <section className={styles.card} aria-labelledby="register-title">
          <AuthHeader kicker="إنشاء حساب جديد" />
          <h1 id="register-title" className={styles.title}>
            إنشاء حساب عميل
          </h1>
          <p className={styles.description}>
            {registrationProof
              ? 'اكتمل التحقق. أضف اسمك وبريدك وكلمة مرور لإكمال حسابك.'
              : registerMethod === 'phone'
                ? 'تحقق من رقم جوالك أولاً، ثم أكمل بيانات حسابك.'
                : 'أدخل بياناتك، ثم افتح رابط التحقق الذي نرسله إلى بريدك لإكمال حسابك.'}
          </p>
          <AuthModeTabs selected="register" next={next} />
          {effectiveError && (
            <p id="register-error" className={styles.error} role="alert">
              {ERROR_MESSAGES[effectiveError] ?? 'تعذر إنشاء الحساب.'}
            </p>
          )}
          {registrationProof?.provider === 'phone' && (
            <div className={styles.governance}>
              <ShieldCheck size={17} aria-hidden />
              <span>
                تم التحقق من الجوال{' '}
                <bdi dir="ltr">
                  {maskCustomerPhone(registrationProof.phone)}
                </bdi>
              </span>
            </div>
          )}
          {!registrationProof && (
            <>
              <GoogleButton
                label="التسجيل باستخدام Google"
                available={googleAvailable}
                next={next}
              />
              {googleAvailable && (
                <div className={styles.divider} role="separator">
                  <span>أو اختر طريقة التسجيل</span>
                </div>
              )}
              <MethodTabs
                step="register"
                selected={registerMethod}
                next={next}
              />
              {registerMethod === 'phone' && (
                <form action={requestCustomerOtp} className={styles.methodForm}>
                  <AuthReturnField next={next} />
                  <input type="hidden" name="intent" value="register" />
                  <label className={styles.field}>
                    <span className={styles.labelText}>رقم الجوال</span>
                    <span className={styles.inputShell} dir="ltr">
                      <Phone size={18} aria-hidden />
                      <input
                        className={styles.input}
                        name="phone"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="05xxxxxxxx"
                        required
                        dir="ltr"
                        aria-invalid={Boolean(effectiveError)}
                        aria-describedby={
                          effectiveError ? 'register-error' : undefined
                        }
                      />
                    </span>
                  </label>
                  <HumanVerificationSubmit
                    siteKey={siteKey}
                    action="customer_otp"
                    label="إرسال رمز التحقق"
                    pendingLabel="جارٍ إرسال رمز التحقق…"
                    turnstileClassName={styles.turnstile}
                    buttonClassName={styles.primary}
                  />
                </form>
              )}
            </>
          )}
          {(registrationProof || registerMethod === 'email') && (
            <form action={registerCustomer} className={styles.methodForm}>
              <AuthReturnField next={next} />
              <label className={styles.field}>
                <span className={styles.labelText}>الاسم الكامل</span>
                <span className={styles.inputShell}>
                  <UserRound size={18} aria-hidden />
                  <input
                    className={styles.input}
                    name="name"
                    autoComplete="name"
                    defaultValue={
                      googleProof ? registrationProof.suggestedName : undefined
                    }
                    minLength={2}
                    maxLength={100}
                    required
                    aria-invalid={Boolean(effectiveError)}
                    aria-describedby={
                      effectiveError ? 'register-error' : undefined
                    }
                  />
                </span>
              </label>
              <label className={styles.field}>
                <span className={styles.labelText}>البريد الإلكتروني</span>
                <span className={styles.inputShell} dir="ltr">
                  <Mail size={18} aria-hidden />
                  <input
                    className={styles.input}
                    name="email"
                    type="email"
                    autoComplete="email"
                    defaultValue={
                      googleProof ? registrationProof.email : undefined
                    }
                    readOnly={googleProof}
                    maxLength={254}
                    required
                    dir="ltr"
                    aria-invalid={Boolean(effectiveError)}
                    aria-describedby={
                      effectiveError ? 'register-error' : undefined
                    }
                  />
                </span>
              </label>
              <div className={styles.field}>
                <label htmlFor="register-password" className={styles.labelText}>
                  كلمة المرور
                </label>
                <span className={styles.inputShell} dir="ltr">
                  <LockKeyhole size={18} aria-hidden />
                  <PasswordInput
                    id="register-password"
                    className={styles.input}
                    name="password"
                    autoComplete="new-password"
                    pattern="(?=.*\p{L})(?=.*\p{N}).*"
                    title="استخدم 12 خانة على الأقل تتضمن حرفاً ورقماً"
                    minLength={12}
                    maxLength={128}
                    required
                    dir="ltr"
                    aria-invalid={Boolean(effectiveError)}
                    aria-describedby={
                      effectiveError
                        ? 'password-hint register-error'
                        : 'password-hint'
                    }
                  />
                </span>
              </div>
              <p id="password-hint" className={styles.hint}>
                12 خانة على الأقل، وتتضمن حرفًا ورقمًا. لا نرسل كلمة المرور
                بالبريد.
              </p>
              {registrationProof ? (
                <SubmitButton
                  className={styles.primary}
                  pendingLabel="جارٍ إنشاء الحساب…"
                >
                  إنشاء الحساب <LogIn size={18} aria-hidden />
                </SubmitButton>
              ) : (
                <HumanVerificationSubmit
                  siteKey={siteKey}
                  action="customer_register"
                  label="إنشاء الحساب بالبريد"
                  pendingLabel="جارٍ إنشاء الحساب…"
                  turnstileClassName={styles.turnstile}
                  buttonClassName={styles.primary}
                />
              )}
            </form>
          )}
          <AuthBackLink href="/login" next={next}>
            لدي حساب بالفعل
          </AuthBackLink>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <section
        className={`${styles.card} ${styles.wideCard}`}
        aria-labelledby="login-title"
      >
        <AuthHeader kicker="حساب العميل" />
        <h1 id="login-title" className={styles.title}>
          مرحبًا بك في رفرف
        </h1>
        <p className={styles.description}>
          سجّل الدخول بالبريد أو الجوال{googleAvailable ? ' أو Google' : ''}.
          ويمكنك إنشاء حساب جديد من هنا.
        </p>
        <AuthModeTabs selected="login" next={next} />
        {effectiveError && (
          <p id="login-error" className={styles.error} role="alert">
            {ERROR_MESSAGES[effectiveError] ?? 'تعذر تسجيل الدخول.'}
          </p>
        )}
        <GoogleButton
          label="المتابعة باستخدام Google"
          available={googleAvailable}
          next={next}
        />
        {googleAvailable && (
          <div className={styles.divider} role="separator">
            <span>أو اختر طريقة الدخول</span>
          </div>
        )}
        <MethodTabs selected={loginMethod} next={next} />
        {loginMethod === 'email' && (
          <form action={signInCustomerPassword} className={styles.methodForm}>
            <AuthReturnField next={next} />
            <label className={styles.field}>
              <span className={styles.labelText}>البريد الإلكتروني</span>
              <span className={styles.inputShell} dir="ltr">
                <Mail size={18} aria-hidden />
                <input
                  className={styles.input}
                  name="email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  required
                  dir="ltr"
                  aria-invalid={Boolean(effectiveError)}
                  aria-describedby={effectiveError ? 'login-error' : undefined}
                />
              </span>
            </label>
            <div className={styles.field}>
              <label htmlFor="login-password" className={styles.labelText}>
                كلمة المرور
              </label>
              <span className={styles.inputShell} dir="ltr">
                <LockKeyhole size={18} aria-hidden />
                <PasswordInput
                  id="login-password"
                  className={styles.input}
                  name="password"
                  autoComplete="current-password"
                  maxLength={128}
                  required
                  dir="ltr"
                  aria-invalid={Boolean(effectiveError)}
                  aria-describedby={effectiveError ? 'login-error' : undefined}
                />
              </span>
            </div>
            <HumanVerificationSubmit
              siteKey={siteKey}
              action="customer_password"
              label="تسجيل الدخول بالبريد"
              pendingLabel="جارٍ تسجيل الدخول…"
              turnstileClassName={styles.turnstile}
              buttonClassName={styles.primary}
            />
          </form>
        )}
        {loginMethod === 'phone' && (
          <form action={requestCustomerOtp} className={styles.methodForm}>
            <AuthReturnField next={next} />
            <label className={styles.field}>
              <span className={styles.labelText}>رقم الجوال</span>
              <span className={styles.inputShell} dir="ltr">
                <Phone size={18} aria-hidden />
                <input
                  className={styles.input}
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="05xxxxxxxx"
                  required
                  dir="ltr"
                  aria-invalid={Boolean(effectiveError)}
                  aria-describedby={effectiveError ? 'login-error' : undefined}
                />
              </span>
            </label>
            <HumanVerificationSubmit
              siteKey={siteKey}
              action="customer_otp"
              label="إرسال رمز الدخول"
              turnstileClassName={styles.turnstile}
              buttonClassName={styles.primary}
            />
          </form>
        )}
        <div className={styles.governance}>
          <ShieldCheck size={17} aria-hidden />
          <span>نتذكرك بأمان على هذا الجهاز لمدة سنة كاملة</span>
        </div>
      </section>
    </main>
  );
}
