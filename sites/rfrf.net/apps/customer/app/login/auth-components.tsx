import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Mail, Phone } from 'lucide-react';
import type { ReactNode } from 'react';
import { BrandLogo } from '@rafraf/ui/brand-logo';
import {
  authLandingPath,
  authMethodPath,
  type CustomerAuthMode,
} from './auth-navigation';
import styles from './login.module.css';
import { withCustomerAuthReturnPath } from '../../lib/customer-auth-return-path';

export function AuthReturnField({ next }: { next?: string }) {
  return <input type="hidden" name="next" value={next ?? '/chat'} />;
}

export function AuthBackLink({
  href,
  next,
  children,
}: {
  href: string;
  next?: string;
  children: ReactNode;
}) {
  return (
    <Link href={withCustomerAuthReturnPath(href, next)} className={styles.back}>
      <ArrowRight size={15} aria-hidden /> {children}
    </Link>
  );
}

export function AuthHeader({ kicker }: { kicker: string }) {
  return (
    <>
      <Link href="/" className={styles.brand} aria-label="رفرف - الرئيسية">
        <BrandLogo />
      </Link>
      <p className={styles.kicker}>{kicker}</p>
    </>
  );
}

export function GoogleButton({
  label,
  available,
  next,
}: {
  label: string;
  available: boolean;
  next?: string;
}) {
  if (!available) return null;

  const content = (
    <>
      <Image
        src="/google-signin-light-square@2x.png"
        width={28}
        height={28}
        alt=""
        aria-hidden
        className={styles.googleLogo}
      />
      <span>{label}</span>
    </>
  );

  return (
    <a
      className={styles.googleButton}
      href={withCustomerAuthReturnPath('/api/auth/google/start', next)}
    >
      {content}
    </a>
  );
}

export function MethodTabs({
  step,
  selected,
  next,
}: {
  step?: 'register';
  selected: 'email' | 'phone';
  next?: string;
}) {
  const mode: CustomerAuthMode = step === 'register' ? 'register' : 'login';
  return (
    <nav className={styles.methodTabs} role="tablist" aria-label="طريقة الدخول">
      <Link
        href={authMethodPath(mode, 'email', next)}
        role="tab"
        aria-selected={selected === 'email'}
        className={selected === 'email' ? styles.activeMethod : undefined}
      >
        <Mail size={17} aria-hidden /> البريد الإلكتروني
      </Link>
      <Link
        href={authMethodPath(mode, 'phone', next)}
        role="tab"
        aria-selected={selected === 'phone'}
        className={selected === 'phone' ? styles.activeMethod : undefined}
      >
        <Phone size={17} aria-hidden /> رقم الجوال
      </Link>
    </nav>
  );
}

export function AuthModeTabs({
  selected,
  next,
}: {
  selected: CustomerAuthMode;
  next?: string;
}) {
  return (
    <nav className={styles.modeTabs} aria-label="التسجيل والدخول">
      <Link
        href={authLandingPath('login', next)}
        aria-current={selected === 'login' ? 'page' : undefined}
        className={selected === 'login' ? styles.activeMode : undefined}
      >
        تسجيل دخول
      </Link>
      <Link
        href={authLandingPath('register', next)}
        aria-current={selected === 'register' ? 'page' : undefined}
        className={selected === 'register' ? styles.activeMode : undefined}
      >
        تسجيل جديد
      </Link>
    </nav>
  );
}
