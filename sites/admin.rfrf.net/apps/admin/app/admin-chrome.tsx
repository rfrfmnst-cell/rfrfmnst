'use client';

import { BrandLogo } from '@rafraf/ui/brand-logo';
import {
  Cable,
  ContactRound,
  LayoutDashboard,
  LogOut,
  PackageSearch,
  Scale,
  ShieldAlert,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { AdminPermission } from '../lib/admin-session';

interface AdminChromeProps {
  children: ReactNode;
  fullName: string | null;
  permissions: readonly AdminPermission[];
}

interface NavigationItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: AdminPermission;
  alsoMatches?: readonly string[];
}

const NAVIGATION: readonly NavigationItem[] = [
  {
    href: '/',
    label: 'التشغيل والطلبات',
    icon: LayoutDashboard,
    alsoMatches: ['/rfq/'],
  },
  { href: '/catalog', label: 'الكتالوج', icon: PackageSearch },
  {
    href: '/customers',
    label: 'العملاء',
    icon: ContactRound,
    permission: 'OPERATIONS_READ',
  },
  {
    href: '/suppliers',
    label: 'الموردون',
    icon: UsersRound,
    permission: 'SUPPLIER_WRITE',
  },
  { href: '/disputes', label: 'النزاعات', icon: Scale },
  {
    href: '/exceptions',
    label: 'الاستثناءات',
    icon: ShieldAlert,
    permission: 'RISK_REVIEW',
  },
  { href: '/integrations', label: 'التكاملات', icon: Cable },
] as const;

function isCurrentPath(pathname: string, item: NavigationItem): boolean {
  if (item.href === '/') {
    return (
      pathname === '/' ||
      Boolean(item.alsoMatches?.some((prefix) => pathname.startsWith(prefix)))
    );
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function AdminChrome({
  children,
  fullName,
  permissions,
}: AdminChromeProps) {
  const pathname = usePathname();
  const printableRoute = pathname.startsWith('/invoice/');

  if (pathname.startsWith('/login') || printableRoute) return children;

  const allowedNavigation = NAVIGATION.filter(
    (item) => !item.permission || permissions.includes(item.permission),
  );

  return (
    <div className="ops-shell">
      <aside className="ops-sidebar" aria-label="تنقل مركز العمليات">
        <Link className="ops-brand" href="/" aria-label="مركز عمليات رفرف">
          <BrandLogo />
          <span className="ops-brand-label">مركز العمليات</span>
        </Link>

        <nav aria-label="الأقسام الإدارية">
          {allowedNavigation.map((item) => {
            const Icon = item.icon;
            const current = isCurrentPath(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={current ? 'active' : undefined}
                aria-current={current ? 'page' : undefined}
                title={item.label}
              >
                <Icon size={18} aria-hidden />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <form className="ops-mobile-logout" action="/logout" method="post">
          <button type="submit" aria-label="تسجيل الخروج" title="تسجيل الخروج">
            <LogOut size={17} aria-hidden />
            <span>خروج</span>
          </button>
        </form>

        <div className="ops-side-card">
          <ShieldCheck size={18} aria-hidden />
          <strong>{fullName?.trim() || 'مشغّل رفرف'}</strong>
          <span>تظهر الأقسام والإجراءات وفق صلاحيات حسابك الحالية.</span>
          <form action="/logout" method="post">
            <button type="submit">
              <LogOut size={16} aria-hidden /> تسجيل الخروج
            </button>
          </form>
        </div>
      </aside>
      <div key={pathname} className="ops-route-content rafraf-page-enter">
        {children}
      </div>
    </div>
  );
}
