import { BrandLogo } from '@rafraf/ui/brand-logo';
import { LayoutDashboard, LogOut, MessageCircle, Settings } from 'lucide-react';
import Link from 'next/link';
import { logoutCustomer } from '../login/actions';
import { SubmitButton } from '@rafraf/ui/submit-button';
import {
  customerAccountPath,
  customerSettingsPath,
} from './account-navigation';
import styles from './account-styles';

export function AccountHeader({
  active,
  customerName,
}: {
  active: 'dashboard' | 'settings';
  customerName: string;
}) {
  return (
    <header className={styles.header}>
      <div className={`container ${styles.headerInner}`}>
        <Link href="/" className={styles.brand} aria-label="رفرف - الرئيسية">
          <BrandLogo descriptor="حساب العميل" />
        </Link>
        <nav className={styles.headerNav} aria-label="التنقل الرئيسي">
          <Link
            href={customerAccountPath()}
            aria-current={active === 'dashboard' ? 'page' : undefined}
          >
            <LayoutDashboard size={16} aria-hidden />
            <span>لوحة العميل</span>
          </Link>
          <Link href="/chat">
            <MessageCircle size={16} aria-hidden />
            <span>المساعد</span>
          </Link>
          <Link
            href={customerSettingsPath()}
            aria-current={active === 'settings' ? 'page' : undefined}
          >
            <Settings size={16} aria-hidden />
            <span>الإعدادات</span>
          </Link>
        </nav>
        <div className={styles.identity}>
          <span>{customerName}</span>
          <form action={logoutCustomer}>
            <SubmitButton className={styles.logout} pendingLabel="جارٍ الخروج…">
              <LogOut size={16} aria-hidden />
              <span>خروج</span>
            </SubmitButton>
          </form>
        </div>
      </div>
    </header>
  );
}
