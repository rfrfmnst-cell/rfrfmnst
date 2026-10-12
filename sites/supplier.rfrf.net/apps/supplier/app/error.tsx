'use client';

import { AppState } from '@rafraf/ui/app-state';
import { Button } from '@rafraf/ui/button';
import Link from 'next/link';

export default function Error({ reset }: { reset: () => void }) {
  return (
    <AppState
      kind="error"
      eyebrow="بوابة المورد"
      title="تعذّر فتح مساحة المورد"
      description="تعذّر تأكيد نتيجة آخر إجراء. تحقّق من حالة العرض والمخزون قبل إعادة المحاولة."
      actions={
        <>
          <Button onClick={reset}>إعادة المحاولة</Button>
          <Link href="/">لوحة المورد</Link>
        </>
      }
    />
  );
}
