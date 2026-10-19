'use client';

import Script from 'next/script';
import { useEffect, useState } from 'react';
import styles from './google-tracking-consent.module.css';

const STORAGE_KEY = 'rafraf-analytics-consent-v1';
type Consent = 'loading' | 'unset' | 'accepted' | 'rejected';

/**
 * Marketing and analytics tags are strictly opt-in. No Google Tag Manager
 * network request is emitted until a visitor explicitly agrees.
 */
export function GoogleTrackingConsent({ containerId }: { containerId: string }) {
  const [consent, setConsent] = useState<Consent>('loading');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      setConsent(stored === 'accepted' || stored === 'rejected' ? stored : 'unset');
    } catch {
      setConsent('unset');
    }
  }, []);

  function selectConsent(next: 'accepted' | 'rejected') {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Non-persistent private browsing must never bypass user consent.
    }
    setConsent(next);
  }

  return (
    <>
      {consent === 'accepted' ? (
        <Script id="rafraf-consented-google-tag-manager" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;
j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;
f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${containerId}');`}
        </Script>
      ) : null}
      {consent === 'unset' ? (
        <aside className={styles.notice} aria-label="الخصوصية وإحصاءات استخدام رفرف">
          <p>
            نستخدم تحليلات اختيارية لفهم استخدام الموقع وتحسين خدمة رفرف.
            لن نفعّل أدوات القياس قبل موافقتك.
          </p>
          <div className={styles.actions}>
            <button type="button" onClick={() => selectConsent('accepted')}>
              أوافق على التحليلات
            </button>
            <button type="button" onClick={() => selectConsent('rejected')}>
              المتابعة بدون تحليلات
            </button>
          </div>
        </aside>
      ) : null}
    </>
  );
}
