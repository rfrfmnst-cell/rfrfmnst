import styles from './suppliers.module.css';
import feedbackStyles from './supplier-feedback.module.css';

export default function SuppliersLoading() {
  return (
    <main className={styles.page} aria-busy="true" aria-label="تحميل الموردين">
      <div className={feedbackStyles.loadingHero} />
      <div className={feedbackStyles.loadingCards}>
        <span />
        <span />
        <span />
      </div>
      <div className={feedbackStyles.loadingRows}>
        <span />
        <span />
        <span />
        <span />
      </div>
      <p className={feedbackStyles.srOnly}>جارٍ تحميل طابور الموردين…</p>
    </main>
  );
}
