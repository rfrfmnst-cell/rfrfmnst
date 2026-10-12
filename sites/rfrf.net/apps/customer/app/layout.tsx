import type { Metadata } from 'next';
import Script from 'next/script';
import { ThemeToggle } from '@rafraf/ui/theme-toggle';
import brandMark from '@rafraf/brand/assets/logo/rafraf-mark.png';
import {
  CUSTOMER_SITE_DESCRIPTION,
  CUSTOMER_SITE_ORIGIN,
  CUSTOMER_SITE_TITLE,
} from '../lib/customer-public-site';
import './globals.css';
import './styles/global-journey-assistant.css';
import './styles/global-assistant-tracking.css';
import './styles/global-tracking-center.css';
import './styles/global-quote-comparison.css';
import './styles/global-ai-workspace.css';
import './styles/global-ai-workspace-responsive.css';
import './styles/global-editorial-system.css';
import './styles/global-customer-dashboard.css';
import './styles/global-rafiq-workspace.css';
import './styles/global-rafiq-decisions.css';
import './styles/global-rafiq-responsive.css';
import './styles/global-industrial-assistant.css';
import './styles/global-industrial-review.css';
import './styles/global-marketplace-foundation.css';
import './styles/global-marketplace-offers.css';
import './styles/global-marketplace-source.css';
import './styles/global-marketplace-responsive-launch.css';
import './chat/production-chat.css';
import './chat/production-chat-cards.css';
import './chat/production-chat-context.css';
import './product-os.css';
import '@rafraf/brand/styles.css';
import './precision-surfaces.css';
import './precision-sections.css';
import './chat/production-chat-history.css';
import './chat/assistant-composer-compat.css';
import './chat/production-chat-professional.css';
import './chat/chat-navigation.css';

const themeBootstrap = [
  '(function(){try{',
  "var saved=localStorage.getItem('rafraf-theme');",
  "var theme=saved==='light'||saved==='dark'?saved:",
  "'light';",
  'document.documentElement.dataset.theme=theme;',
  'document.documentElement.style.colorScheme=theme;',
  "}catch(e){document.documentElement.dataset.theme='light';}})();",
].join('');

const enableDesignCapture = process.env.NODE_ENV === 'development';

export const metadata: Metadata = {
  metadataBase: new URL(CUSTOMER_SITE_ORIGIN),
  title: CUSTOMER_SITE_TITLE,
  description: CUSTOMER_SITE_DESCRIPTION,
  openGraph: {
    type: 'website',
    locale: 'ar_SA',
    siteName: 'رفرف',
    title: CUSTOMER_SITE_TITLE,
    description: CUSTOMER_SITE_DESCRIPTION,
    images: [
      {
        url: brandMark.src,
        width: brandMark.width,
        height: brandMark.height,
        alt: 'شعار رفرف',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: CUSTOMER_SITE_TITLE,
    description: CUSTOMER_SITE_DESCRIPTION,
    images: [{ url: brandMark.src, alt: 'شعار رفرف' }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#FBF8F2" />
        <Script id="rafraf-theme-bootstrap" strategy="beforeInteractive">
          {themeBootstrap}
        </Script>
        {enableDesignCapture ? (
          <>
            <script
              dangerouslySetInnerHTML={{
                __html:
                  "addEventListener('load',function(){scrollTo({top:0,left:0,behavior:'instant'})},{once:true});",
              }}
            />
            <script
              src="https://mcp.figma.com/mcp/html-to-design/capture.js"
              async
            />
          </>
        ) : null}
      </head>
      <body>
        {children}
        <ThemeToggle />
      </body>
    </html>
  );
}
