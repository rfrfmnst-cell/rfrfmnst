import { AppState } from '@rafraf/ui/app-state';

export default function Loading() {
  return (
    <AppState
      kind="loading"
      eyebrow="بوابة المورد"
      title="نحدّث مساحة المورد"
      description="نراجع فرص التسعير والعروض والمخزون والشحنات بأحدث بيانات متاحة."
    />
  );
}
