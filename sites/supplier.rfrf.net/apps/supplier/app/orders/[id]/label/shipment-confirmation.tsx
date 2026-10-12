'use client';

import {
  CheckCircle2,
  PackageCheck,
  ScanLine,
  ShieldCheck,
  Truck,
  X,
} from 'lucide-react';
import { useRef } from 'react';
import { SubmitButton } from '@rafraf/ui/submit-button';
import { createInternalShipmentLabel } from './actions';
import styles from './label.module.css';

interface ShipmentConfirmationProps {
  orderId: string;
  routeId: string;
  orderCode: string;
  quantity: number;
}

export function ShipmentConfirmation({
  orderId,
  routeId,
  orderCode,
  quantity,
}: ShipmentConfirmationProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        className={styles.primary}
        onClick={() => dialogRef.current?.showModal()}
      >
        <CheckCircle2 size={18} aria-hidden />
        مراجعة وإنشاء المرجع
      </button>

      <dialog
        ref={dialogRef}
        className={styles.confirmDialog}
        aria-labelledby="shipment-confirm-title"
        aria-describedby="shipment-confirm-description"
      >
        <button
          type="button"
          className={styles.dialogClose}
          aria-label="إغلاق نافذة تأكيد الشحن"
          onClick={() => dialogRef.current?.close()}
        >
          <X size={20} aria-hidden />
        </button>

        <header className={styles.dialogHeader}>
          <span className={styles.dialogIcon} aria-hidden>
            <Truck size={28} />
          </span>
          <div>
            <p>RAFRAF FULFILLMENT</p>
            <h2 id="shipment-confirm-title">تأكيد إنشاء مرجع الشحن</h2>
            <span id="shipment-confirm-description">
              راجع التفاصيل قبل تثبيت المرجع الداخلي. لا يتم استدعاء ناقل خارجي
              في هذه الخطوة.
            </span>
          </div>
        </header>

        <section className={styles.confirmMetrics} aria-label="ملخص الشحنة">
          <article>
            <span>الطلب</span>
            <strong dir="ltr">{orderCode}</strong>
          </article>
          <article>
            <span>الكمية</span>
            <strong>{quantity.toLocaleString('ar-SA')}</strong>
          </article>
          <article>
            <span>الطرود</span>
            <strong>1</strong>
          </article>
        </section>

        <section className={styles.trackingPreview} aria-label="مرجع التتبع">
          <ScanLine size={22} aria-hidden />
          <span>
            <b>مرجع أولي</b>
            <small>
              سيُنشأ رقم تتبع داخلي فريد للطلب <bdi dir="ltr">{orderCode}</bdi>
            </small>
          </span>
          <em>RAFRAF INTERNAL</em>
        </section>

        <section
          className={styles.confirmChecklist}
          aria-labelledby="shipment-checklist-title"
        >
          <PackageCheck size={22} aria-hidden />
          <div>
            <h3 id="shipment-checklist-title">قائمة التحقق قبل الإنشاء</h3>
            <ul>
              <li>تمت مراجعة القطعة والكمية وحالة التغليف.</li>
              <li>الطلب «جاهز للشحن» ومملوك لحساب المورد الحالي.</li>
              <li>لن تتم طباعة الملصق النهائي قبل حفظ رقم التتبع فعليًا.</li>
            </ul>
          </div>
        </section>

        <div className={styles.dialogGovernance}>
          <ShieldCheck size={19} aria-hidden />
          <span>
            لا يحتوي المرجع على اسم العميل أو جواله أو السعر النهائي، ولا يغيّر
            شحنة مرتبطة بناقل خارجي.
          </span>
        </div>

        <footer className={styles.dialogActions}>
          <button
            type="button"
            className={styles.dialogSecondary}
            onClick={() => dialogRef.current?.close()}
          >
            العودة للمراجعة
          </button>
          <a className={styles.dialogSecondary} href="/shipments">
            قائمة الشحن
          </a>
          <form action={createInternalShipmentLabel}>
            <input type="hidden" name="orderId" value={orderId} />
            <input type="hidden" name="routeId" value={routeId} />
            <SubmitButton
              className={styles.dialogPrimary}
              pendingLabel="جارٍ إنشاء المرجع…"
            >
              <CheckCircle2 size={18} aria-hidden />
              تأكيد الإنشاء
            </SubmitButton>
          </form>
        </footer>
      </dialog>
    </>
  );
}
