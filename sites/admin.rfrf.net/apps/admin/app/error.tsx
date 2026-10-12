'use client';

import { AppState } from '@rafraf/ui/app-state';
import { Button } from '@rafraf/ui/button';
import Link from 'next/link';

export default function Error({ reset }: { reset: () => void }) {
  return (
    <main>
      <AppState
        kind="error"
        eyebrow="مركز العمليات"
        title="تعذّر تحميل بيانات التشغيل"
        description="تعذّر تأكيد نتيجة آخر إجراء. تحقّق من الحالة الحالية قبل إعادة المحاولة لتجنّب تكرار أي كتابة أو إجراء مالي."
        actions={
          <>
            <Button onClick={reset}>إعادة المحاولة</Button>
            <Link href="/">مركز العمليات</Link>
          </>
        }
      />
    </main>
  );
}
