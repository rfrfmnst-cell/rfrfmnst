import {
  Bot,
  CheckCircle2,
  CircleDashed,
  Cloud,
  CreditCard,
  Database,
  MessageSquareText,
  Settings2,
  Truck,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { requireAdminPermission } from '../../lib/require-admin-session';
import {
  safeIntegrationStatuses,
  type IntegrationId,
} from '../../lib/integration-status';
import styles from './integrations.module.css';
import { GlobalSupplierNetwork } from './global-supplier-network';

export const dynamic = 'force-dynamic';

const ICONS: Record<
  IntegrationId,
  ComponentType<{ size?: number; 'aria-hidden'?: boolean }>
> = {
  ai: Bot,
  payments: CreditCard,
  shipping: Truck,
  storage: Cloud,
  sms: MessageSquareText,
  database: Database,
};

export default async function IntegrationsPage() {
  const admin = await requireAdminPermission('OPERATIONS_READ');
  const integrations = await safeIntegrationStatuses();
  const configured = integrations.filter((item) => item.configured).length;
  const verified = integrations.filter((item) => item.verified).length;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>
            <Settings2 size={16} aria-hidden /> INTEGRATION CONTROL PLANE
          </p>
          <h1>حالة التكاملات</h1>
          <span>
            لقطة خادمية آمنة تفصل بين اكتمال الإعداد وإثبات الاتصال الحي، من دون
            عرض أي مفتاح أو سر.
          </span>
        </div>
      </header>

      <section className={styles.summary} aria-label="ملخص حالة التكاملات">
        <article>
          <span>إجمالي التكاملات</span>
          <strong>{integrations.length.toLocaleString('ar-SA')}</strong>
        </article>
        <article>
          <span>مُهيّأة بنيوياً</span>
          <strong>{configured.toLocaleString('ar-SA')}</strong>
        </article>
        <article>
          <span>مُتحقق منها الآن</span>
          <strong>{verified.toLocaleString('ar-SA')}</strong>
        </article>
      </section>

      <p className={styles.notice} role="note">
        «مُهيّأ» لا يعني «جاهز للإطلاق». التحقق الحي يظهر فقط عندما ينجح فحص آمن
        في الطلب الحالي؛ أما الدفع وAI والشحن فتظل غير موثقة حتى اختبارها في
        بيئة Preview المخصصة.
      </p>

      <section className={styles.grid} aria-label="تفاصيل التكاملات">
        {integrations.map((integration) => {
          const Icon = ICONS[integration.id];
          return (
            <article className={styles.card} key={integration.id}>
              <header>
                <span className={styles.icon}>
                  <Icon size={21} aria-hidden />
                </span>
                <div>
                  <h2>{integration.label}</h2>
                  <p>{integration.detail}</p>
                </div>
              </header>

              <dl className={styles.states}>
                <div>
                  <dt>الإعداد</dt>
                  <dd
                    className={
                      integration.configured ? styles.ok : styles.pending
                    }
                  >
                    {integration.configured ? (
                      <CheckCircle2 size={16} aria-hidden />
                    ) : (
                      <CircleDashed size={16} aria-hidden />
                    )}
                    {integration.configured ? 'مُهيّأ' : 'غير مكتمل'}
                  </dd>
                </div>
                <div>
                  <dt>التحقق الحي</dt>
                  <dd
                    className={
                      integration.verified ? styles.ok : styles.pending
                    }
                  >
                    {integration.verified ? (
                      <CheckCircle2 size={16} aria-hidden />
                    ) : (
                      <CircleDashed size={16} aria-hidden />
                    )}
                    {integration.verified ? 'مُثبت الآن' : 'غير مُثبت'}
                  </dd>
                </div>
              </dl>

              <p className={styles.evidence}>{integration.verificationNote}</p>
            </article>
          );
        })}
      </section>
      <GlobalSupplierNetwork
        canReviewSuppliers={admin.permissions.includes('SUPPLIER_WRITE')}
      />
    </main>
  );
}
