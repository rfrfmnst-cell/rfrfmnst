import { BrandLogo } from '@rafraf/ui/brand-logo';
import styles from './account-styles';
import dashboardStyles from './customer-dashboard-styles';

export default function AccountLoading() {
  return (
    <>
      <header className={styles.header}>
        <div className={`container ${styles.headerInner}`}>
          <span className={styles.brand}>
            <BrandLogo descriptor="حساب العميل" />
          </span>
        </div>
      </header>
      <main
        className={`container ${dashboardStyles.skeleton}`}
        aria-busy="true"
        aria-label="جارٍ تحميل حسابك"
      >
        <span className={dashboardStyles.visuallyHidden} role="status">
          جارٍ تحميل عروضك وطلباتك…
        </span>
        <div className={dashboardStyles.skeletonLine} />
        <div
          className={`${dashboardStyles.skeletonLine} ${dashboardStyles.skeletonLineSmall}`}
        />
        <div
          className={`${dashboardStyles.skeletonCard} ${dashboardStyles.skeletonHero}`}
        />
        <div className={dashboardStyles.skeletonMetrics}>
          {Array.from({ length: 4 }, (_, index) => (
            <div className={dashboardStyles.skeletonCard} key={index} />
          ))}
        </div>
        <div
          className={`${dashboardStyles.skeletonCard} ${dashboardStyles.skeletonPanel}`}
        />
      </main>
    </>
  );
}
