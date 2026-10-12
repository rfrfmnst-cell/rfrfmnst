'use client';

import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './exception-shortcut.module.css';

export function ExceptionShortcut() {
  const pathname = usePathname();

  if (
    pathname === '/login' ||
    pathname.startsWith('/login/') ||
    pathname === '/exceptions' ||
    pathname.startsWith('/exceptions/') ||
    pathname.startsWith('/invoice/')
  ) {
    return null;
  }

  return (
    <Link
      className={styles.shortcut}
      href="/exceptions"
      data-exception-shortcut
    >
      <span className={styles.icon}>
        <AlertTriangle size={18} aria-hidden />
      </span>
      <span>
        <strong>طابور الاستثناءات</strong>
        <small>مرتفع أو محظور · قرار بشري</small>
      </span>
    </Link>
  );
}
