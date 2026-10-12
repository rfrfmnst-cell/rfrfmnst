'use client';

import { useEffect, useRef } from 'react';
import styles from './exception.module.css';

type ApprovedDecisionDialogProps = {
  affectedOrders: number;
  decisionId: string;
  deliveryGainDays: number | null;
  fitmentConfidence: number;
  returnFocusId: string;
  rollbackMinutes: number;
};

function dismissalKey(decisionId: string): string {
  return `rafraf:approved-decision:${decisionId}`;
}

export function ApprovedDecisionDialog({
  affectedOrders,
  decisionId,
  deliveryGainDays,
  fitmentConfidence,
  returnFocusId,
  rollbackMinutes,
}: ApprovedDecisionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    try {
      if (window.sessionStorage.getItem(dismissalKey(decisionId)) === '1') {
        return;
      }
    } catch {
      // Storage can be unavailable in hardened browsers; the persisted audit
      // remains the source of truth and the dialog can still be shown safely.
    }

    if (!dialog.open) dialog.showModal();
    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(focusFrame);
  }, [decisionId]);

  const closeDialog = () => {
    dialogRef.current?.close();
  };

  const handleClose = () => {
    try {
      window.sessionStorage.setItem(dismissalKey(decisionId), '1');
    } catch {
      // A storage failure must not prevent the user from closing the dialog.
    }

    document.getElementById(returnFocusId)?.focus();
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.approvedDialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="approved-decision-title"
      aria-describedby="approved-decision-description"
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
      onClose={handleClose}
    >
      <h2 id="approved-decision-title" className={styles.approvedTitle}>
        تم اعتماد القرار
      </h2>
      <p
        id="approved-decision-description"
        className={styles.approvedDescription}
      >
        أُوقف العرض عالي المخاطر، واعتمد البديل المحلي، وأُعيد احتساب ترتيب
        عروض البند ضمن نطاق التنفيذ المعتمد.
      </p>

      <section
        className={styles.approvedEvidence}
        aria-labelledby="approved-evidence-title"
      >
        <h3 id="approved-evidence-title">نطاق التنفيذ والحوكمة</h3>
        <div className={styles.approvedEvidenceRow}>
          <span>طلبات قائمة مرتبطة عند الاعتماد</span>
          <strong>{affectedOrders.toLocaleString('ar-SA')}</strong>
        </div>
        <div className={styles.approvedEvidenceRow}>
          <span>تحسن الحد الأقصى لمدة التوريد</span>
          <strong>
            {deliveryGainDays == null
              ? '—'
              : `${deliveryGainDays.toLocaleString('ar-SA')} د`}
          </strong>
        </div>
        <div className={styles.approvedEvidenceRow}>
          <span>نافذة التراجع الآمن المتبقية</span>
          <strong>{rollbackMinutes.toLocaleString('ar-SA')} د</strong>
        </div>
        <div
          className={`${styles.approvedEvidenceRow} ${styles.approvedConfidence}`}
        >
          <span>ثقة مطابقة البديل بعد مراجعة المدير</span>
          <strong>{fitmentConfidence.toLocaleString('ar-SA')}%</strong>
        </div>
      </section>

      <p className={styles.approvedFootnote}>
        سُجّل القرار في Audit Log · قرار بشري · لا تنفيذ خارج النطاق المعتمد.
      </p>

      <button
        ref={closeButtonRef}
        type="button"
        className={styles.approvedClose}
        onClick={closeDialog}
      >
        العودة لمركز العمليات
      </button>
    </dialog>
  );
}
