'use client';

import '@rafraf/brand/styles.css';
import { AppState } from '@rafraf/ui/app-state';
import { Button } from '@rafraf/ui/button';
import { RAFRAF_THEME_BOOTSTRAP } from '@rafraf/ui/theme-bootstrap';

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#FBF8F2" />
        <script id="rafraf-theme-bootstrap">{RAFRAF_THEME_BOOTSTRAP}</script>
      </head>
      <body>
        <main>
          <AppState
            kind="error"
            eyebrow="رفرف"
            title="تعذّر تشغيل تجربة العميل"
            description="قد تكون آخر خطوة اكتملت قبل ظهور الخطأ. تحقّق من حسابك قبل إعادة التشغيل أو تكرار الطلب."
            actions={<Button onClick={reset}>إعادة التشغيل</Button>}
          />
        </main>
      </body>
    </html>
  );
}
