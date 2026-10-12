import type { Metadata } from 'next';
import Script from 'next/script';
import { ThemeToggle } from '@rafraf/ui/theme-toggle';
import { ExceptionShortcut } from './exception-shortcut';
import { getAdminPrincipal } from '../lib/require-admin-session';
import { AdminChrome } from './admin-chrome';
import './globals.css';
import './admin-content.css';
import './command-center-responsive.css';
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
  title: 'مركز عمليات رفرف',
  description: 'مركز تشغيل قرارات ومخاطر وطلبات رفرف.',
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const principal = await getAdminPrincipal();

  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#FBF8F2" />
        <Script id="rafraf-theme-bootstrap" strategy="beforeInteractive">
          {themeBootstrap}
        </Script>
      </head>
      <body>
        {principal ? (
          <AdminChrome
            fullName={principal.fullName}
            permissions={principal.permissions}
          >
            {children}
          </AdminChrome>
        ) : (
          children
        )}
        {principal?.permissions.includes('RISK_REVIEW') ? (
          <ExceptionShortcut />
        ) : null}
        <ThemeToggle />
      </body>
    </html>
  );
}
