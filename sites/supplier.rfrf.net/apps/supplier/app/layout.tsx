import type { Metadata } from 'next';
import Script from 'next/script';
import { BadgeCheck, LifeBuoy } from 'lucide-react';
import Link from 'next/link';
import { ThemeToggle } from '@rafraf/ui/theme-toggle';
import { BrandLogo } from '@rafraf/ui/brand-logo';
import { SupplierNav } from './supplier-nav';
import './globals.css';
import './auth-proof.css';
import './editorial.css';
import './product-os.css';
import '@rafraf/brand/styles.css';
import './precision-theme.css';

const themeBootstrap = [
  '(function(){try{',
  "var saved=localStorage.getItem('rafraf-theme');",
  "var theme=saved==='light'||saved==='dark'?saved:",
  "'light';",
  'document.documentElement.dataset.theme=theme;',
  'document.documentElement.style.colorScheme=theme;',
  "}catch(e){document.documentElement.dataset.theme='light';}})();",
].join('');

export const metadata: Metadata = {
  title: 'بوابة موردي رفرف',
  description: 'إدارة عروض وطلبات وشحنات موردي رفرف المعتمدين.',
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#FBF8F2" />
        <Script id="rafraf-theme-bootstrap" strategy="beforeInteractive">
          {themeBootstrap}
        </Script>
      </head>
      <body>
        <div className="supplier-shell">
          <aside className="sp-sidebar">
            <Link href="/" className="sp-side-brand" aria-label="رفرف للموردين">
              <BrandLogo descriptor="بوابة الموردين" />
            </Link>
            <SupplierNav />
            <div className="sp-side-bottom">
              <a href="mailto:suppliers@rafraf.sa" title="دعم الموردين">
                <LifeBuoy size={18} aria-hidden /> <span>دعم الموردين</span>
              </a>
              <form action="/login/logout" method="POST">
                <button type="submit" className="logout-btn">
                  خروج
                </button>
              </form>
              <p>
                <BadgeCheck size={16} aria-hidden /> <span>اتصال آمن</span>
              </p>
            </div>
          </aside>
          <main className="sp-main rafraf-page-enter">{children}</main>
        </div>
        <ThemeToggle />
      </body>
    </html>
  );
}
