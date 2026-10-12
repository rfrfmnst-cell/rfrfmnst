import { AppState } from '@rafraf/ui/app-state';
import Link from 'next/link';

export default function NotFound() {
  return (
    <AppState
      kind="not-found"
      eyebrow="بوابة المورد"
      title="الصفحة غير موجودة في بوابة المورد"
      description="تحقق من الرابط أو ارجع إلى لوحة المورد لفتح فرص التسعير والمخزون والشحنات."
      actions={
        <Link className="rafraf-app-state__primary" href="/">
          العودة إلى لوحة المورد
        </Link>
      }
    />
  );
}
