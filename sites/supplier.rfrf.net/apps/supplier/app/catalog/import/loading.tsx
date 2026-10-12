import { LoaderCircle } from 'lucide-react';
import styles from './import-shell.module.css';

export default function CatalogImportLoading() {
  return (
    <div className={styles.skeleton} role="status" aria-live="polite">
      <div>
        <LoaderCircle className={styles.spinner} size={28} aria-hidden />
        <b>جارٍ تجهيز مساحة استيراد الكتالوج…</b>
        <span>نحمّل مستودعات منشأتك ومؤشرات المخزون بأمان.</span>
      </div>
    </div>
  );
}
