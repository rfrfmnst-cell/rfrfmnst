import { AppState } from '@rafraf/ui/app-state';
import Link from 'next/link';

export default function NotFound() {
  return (
    <main>
      <AppState
        kind="not-found"
        eyebrow="رفرف"
        title="الصفحة غير موجودة"
        description="قد يكون الرابط قديماً أو غير مكتمل. ارجع إلى الرئيسية أو تابع طلبك من صفحة التتبع."
        actions={
          <Link className="rafraf-app-state__primary" href="/">
            العودة إلى الرئيسية
          </Link>
        }
      />
    </main>
  );
}
