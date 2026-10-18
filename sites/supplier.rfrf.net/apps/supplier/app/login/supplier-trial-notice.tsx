import { CalendarDays, Check } from 'lucide-react';
import styles from './supplier-trial-notice.module.css';

export function SupplierTrialNotice() {
  return (
    <aside className={styles.notice} aria-labelledby="supplier-trial-title">
      <CalendarDays size={24} aria-hidden />
      <div>
        <h2 id="supplier-trial-title">جرّب رفرف لمدة 3 أشهر</h2>
        <p>
          للموردين والباعة والتجار: فترة تجريبية لمدة ثلاثة أشهر للتعرّف على
          رفرف وتجربة العمل على المنصة.
        </p>
        <p className={styles.choice}>
          <Check size={18} aria-hidden />
          <span>
            بعدها لك حرية الانتقال إلى إحدى الخطط المدفوعة أو المغادرة، دون
            إلزام باختيار خطة مدفوعة.
          </span>
        </p>
      </div>
    </aside>
  );
}
