import { AppState } from '@rafraf/ui/app-state';
import Link from 'next/link';

export default function NotFound() {
  return (
    <main>
      <AppState
        kind="not-found"
        eyebrow="مركز العمليات"
        title="المسار الإداري غير موجود"
        description="قد يكون الرابط قديماً أو خارج صلاحيات هذا المسار. ارجع إلى مركز العمليات واختر القسم المطلوب."
        actions={
          <Link className="rafraf-app-state__primary" href="/">
            العودة إلى مركز العمليات
          </Link>
        }
      />
    </main>
  );
}
