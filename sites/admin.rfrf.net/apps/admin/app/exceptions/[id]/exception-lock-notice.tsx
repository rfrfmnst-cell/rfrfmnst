import { LockKeyhole } from 'lucide-react';
import styles from './exception.module.css';

export function ExceptionLockNotice({
  fitmentLocked,
  latestRiskLevel,
  nonReviewable,
  orderLocked,
  rfqLocked,
  rfqStatus,
  riskLevel,
  staleRisk,
}: {
  fitmentLocked: boolean;
  latestRiskLevel: string | null | undefined;
  nonReviewable: boolean;
  orderLocked: boolean;
  rfqLocked: boolean;
  rfqStatus: string;
  riskLevel: string;
  staleRisk: boolean;
}) {
  const message = nonReviewable ? (
    <>
      مستوى هذا التقييم <b>{riskLevel}</b> لا يتطلب قرار استثناء. الصفحة متاحة
      للتدقيق فقط، وجميع الأفعال معطلة.
    </>
  ) : staleRisk ? (
    <>
      هذا التقييم مؤرشف ولا يقبل قرارًا؛ يوجد تقييم أحدث للعرض بمستوى{' '}
      <b>{latestRiskLevel ?? 'غير معروف'}</b>. افتح الحالة الحالية من طابور
      الاستثناءات.
    </>
  ) : rfqLocked ? (
    <>
      الحالة مقفلة لأن RFQ أصبح <b>{rfqStatus}</b>. يمكن مراجعة الأدلة، لكن لا
      يمكن تبديل العرض بعد التزام العميل أو تحويله لطلب.
    </>
  ) : fitmentLocked ? (
    <>
      التوافق غير مكتمل أو أقل من 85%؛ يجب تثبيت القطعة وإنهاء المراجعة البشرية
      قبل اعتماد أي بديل.
    </>
  ) : orderLocked ? (
    <>
      يوجد Order مرتبط بهذا العرض؛ القرار أصبح للعرض والتدقيق فقط ولا يمكن
      استبدال العرض بعد إنشاء الطلب.
    </>
  ) : null;

  if (!message) return null;

  return (
    <section className={styles.safeNote} role="status">
      <LockKeyhole size={18} aria-hidden />
      <span>{message}</span>
    </section>
  );
}
