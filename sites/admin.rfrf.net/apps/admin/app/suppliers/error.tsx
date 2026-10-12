'use client';

import { CircleAlert, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import styles from './suppliers.module.css';
import feedbackStyles from './supplier-feedback.module.css';

export default function SuppliersError({ reset }: { reset: () => void }) {
  return (
    <main className={styles.page}>
      <section
        className={`${styles.fatal} ${feedbackStyles.fatal}`}
        role="alert"
      >
        <CircleAlert size={34} aria-hidden />
        <h1>تعذّر تحميل طابور الموردين</h1>
        <p>لم يُنفّذ أي قرار. أعد المحاولة أو ارجع إلى مركز العمليات.</p>
        <div>
          <button type="button" onClick={reset}>
            <RotateCcw size={16} aria-hidden /> إعادة المحاولة
          </button>
          <Link href="/">مركز العمليات</Link>
        </div>
      </section>
    </main>
  );
}
