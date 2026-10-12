import { CheckCircle2, CircleDashed, Globe2 } from 'lucide-react';
import Link from 'next/link';
import {
  globalDiscoveryProviderStatuses,
  type GlobalDiscoveryProviderKey,
} from '../../lib/global-sourcing/provider-registry';
import styles from './integrations.module.css';

const REQUIRED_SETUP: Record<GlobalDiscoveryProviderKey, string> = {
  APM_GROUP: 'يلزم حساب تجاري موثق واتصال من عنوان خروج ثابت معتمد لدى المورد.',
  EBAY_BROWSE:
    'يلزم حساب مطور معتمد وتحديد سوق البحث ووجهة التسليم إلى السعودية.',
  ABCP_UAE:
    'يلزم حساب تجاري وتفعيل API لدى تاجر جملة في الإمارات يعمل على ABCP، والتحقق من الشحن إلى السعودية.',
};

export function GlobalSupplierNetwork({
  canReviewSuppliers,
}: {
  canReviewSuppliers: boolean;
}) {
  const providers = globalDiscoveryProviderStatuses();

  return (
    <section aria-labelledby="global-suppliers-heading">
      <header className={styles.notice}>
        <h2 id="global-suppliers-heading">شبكة المصادر والموردين العالميين</h2>
        <p>
          جهّز حساب المصدر ثم اختبر البحث من طلب تسعير قائم. تُراجع النتائج داخل
          العمليات؛ السعر الخام لا يشمل الشحن والرسوم ولا يمثل عرضاً نهائياً
          للعميل.
        </p>
      </header>
      <div className={styles.grid}>
        {providers.map((provider) => (
          <article className={styles.card} key={provider.key}>
            <header>
              <span className={styles.icon}>
                <Globe2 size={21} aria-hidden />
              </span>
              <div>
                <h2>{provider.label}</h2>
                <p>{provider.inputHint}</p>
              </div>
            </header>
            <dl className={styles.states}>
              <div>
                <dt>إعداد الاتصال</dt>
                <dd
                  className={provider.configured ? styles.ok : styles.pending}
                >
                  {provider.configured ? (
                    <CheckCircle2 size={16} aria-hidden />
                  ) : (
                    <CircleDashed size={16} aria-hidden />
                  )}
                  {provider.configured
                    ? 'مُهيّأ للاختبار'
                    : 'بانتظار الحساب وإعداد الاتصال'}
                </dd>
              </div>
              <div>
                <dt>التحقق الحي</dt>
                <dd className={styles.pending}>
                  راجع نتيجة آخر بحث في طلب التسعير
                </dd>
              </div>
            </dl>
            <p className={styles.evidence}>
              {REQUIRED_SETUP[provider.key]} تعرض هذه البطاقات الإعداد فقط؛ ولا
              تبحث لدى المصدر أو تنفذ شراءً.
            </p>
          </article>
        ))}
        <article className={styles.card}>
          <header>
            <div>
              <h2>الموردون الدوليون المسجلون في رفرف</h2>
            </div>
          </header>
          <p>
            يسجل المورد منشأته في بوابة المورد، ويثبت بيانات التواصل ويرفع
            وثيقته. بعد مراجعة الإدارة واعتماده يستطيع تقديم عروضه من لوحته.
          </p>
          {canReviewSuppliers ? (
            <Link href="/suppliers">مراجعة الموردين المسجلين</Link>
          ) : (
            <p className={styles.evidence}>المراجعة متاحة للمشغلين المخولين.</p>
          )}
        </article>
        <article className={styles.card}>
          <header>
            <div>
              <h2>توسيع شبكة التوريد</h2>
            </div>
          </header>
          <p>
            تبدأ المقارنة من رقم القطعة، ثم مراجعة التوافق والتوفر والشحن
            والرسوم. يحتاج الشراء عبر موزع خارجي إلى اتفاق تجاري وتكامل مستقل
            قبل تفعيله.
          </p>
          <Link href="/">فتح لوحة العمليات وطلبات التسعير</Link>
        </article>
      </div>
    </section>
  );
}
