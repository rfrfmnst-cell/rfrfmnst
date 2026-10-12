import { AppState } from '@rafraf/ui/app-state';

export default function Loading() {
  return (
    <main>
      <AppState
        kind="loading"
        eyebrow="مركز العمليات"
        title="نحمّل بيانات التشغيل"
        description="نحدّث الطلبات والاستثناءات والموردين والمدفوعات مع الحفاظ على صلاحيات حسابك."
      />
    </main>
  );
}
