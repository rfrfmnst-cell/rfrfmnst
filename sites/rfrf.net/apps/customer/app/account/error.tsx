'use client';

import { BrandLogo } from '@rafraf/ui/brand-logo';
import { AlertCircle, MessageCircle, RefreshCcw } from 'lucide-react';
import Link from 'next/link';
import styles from './account-styles';
import dashboardStyles from './customer-dashboard-styles';

export default function AccountError({ reset }: { reset: () => void }) {
  return (
    <>
      <header className={styles.header}>
        <div className={`container ${styles.headerInner}`}>
          <Link href="/" className={styles.brand} aria-label="رفرف - الرئيسية">
            <BrandLogo descriptor="حساب العميل" />
          </Link>
        </div>
      </header>
      <main className={`container ${dashboardStyles.errorPage}`}>
        <section className={dashboardStyles.errorState} role="alert">
          <span>
            <AlertCircle size={26} aria-hidden />
          </span>
          <p>تعذّر تحميل الحساب</p>
          <h1>لم نتمكن من جلب طلباتك الآن</h1>
          <div>
            <button type="button" onClick={reset}>
              <RefreshCcw size={17} aria-hidden /> إعادة المحاولة
            </button>
            <Link href="/chat">
              <MessageCircle size={17} aria-hidden /> فتح المساعد
            </Link>
          </div>
          <small>
            لم تتغير أي من طلباتك أو مدفوعاتك. أعد المحاولة بعد لحظات.
          </small>
        </section>
      </main>
    </>
  );
}
