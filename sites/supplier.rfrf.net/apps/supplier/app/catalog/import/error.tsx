'use client';

import { AlertTriangle, RefreshCcw } from 'lucide-react';
import styles from './import-shell.module.css';

export default function CatalogImportError({ reset }: { reset: () => void }) {
  return (
    <section className={styles.errorBoundary} role="alert">
      <AlertTriangle size={34} aria-hidden />
      <h1>تعذّر فتح مساحة الاستيراد</h1>
      <p>
        لم تُكتب أي بيانات. أعد المحاولة، وإن استمر الخطأ تواصل مع دعم موردي
        رفرف.
      </p>
      <button type="button" onClick={reset}>
        <RefreshCcw size={16} aria-hidden /> إعادة المحاولة
      </button>
    </section>
  );
}
