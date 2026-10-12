'use client';

import { AppState } from '@rafraf/ui/app-state';
import { Button } from '@rafraf/ui/button';
import Link from 'next/link';

export default function Error({ reset }: { reset: () => void }) {
  return (
    <main>
      <AppState
        kind="error"
        eyebrow="حساب العميل"
        title="تعذّر تحميل هذه الخطوة"
        description="تعذّر تأكيد نتيجة آخر خطوة. تحقّق من حسابك قبل إعادة المحاولة أو تكرار الطلب."
        actions={
          <>
            <Button onClick={reset}>إعادة المحاولة</Button>
            <Link href="/account">العودة إلى حسابي</Link>
          </>
        }
      />
    </main>
  );
}
