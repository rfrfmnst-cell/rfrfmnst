import { AppState } from '@rafraf/ui/app-state';

export default function Loading() {
  return (
    <main>
      <AppState
        kind="loading"
        eyebrow="متابعة الطلب"
        title="نجهّز متابعة طلبك"
        description="نحمّل حالة طلبك والعروض المتاحة دون تغيير أي قرار أو إرسال طلب جديد."
      />
    </main>
  );
}
