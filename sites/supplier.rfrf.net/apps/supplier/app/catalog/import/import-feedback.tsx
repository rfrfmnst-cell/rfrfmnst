"use client";

import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import type { CatalogImportState } from "./catalog-import";
import styles from "./import-result.module.css";

export function CatalogImportFeedback({
  pending,
  state,
  onImportAnother,
}: {
  pending: boolean;
  state: CatalogImportState;
  onImportAnother: () => void;
}) {
  return (
    <>
      {pending ? (
        <div className={styles.processing} role="status" aria-live="polite">
          <LoaderCircle className={styles.spinner} size={21} aria-hidden />
          <span>
            <b>جارٍ فحص الملف على الخادم</b>
            <small>
              يتم التحقق من الأنواع والتكرار وملكية المستودعات قبل أي كتابة.
            </small>
          </span>
        </div>
      ) : null}

      {state.status !== "idle" && state.message ? (
        <section
          className={`${styles.result} ${
            state.status === "success"
              ? styles.resultSuccess
              : styles.resultError
          }`}
          aria-live="polite"
          role={state.status === "success" ? "status" : "alert"}
        >
          <div className={styles.resultHead}>
            {state.status === "success" ? (
              <CheckCircle2 size={24} aria-hidden />
            ) : (
              <AlertTriangle size={24} aria-hidden />
            )}
            <span>
              <b>{state.message}</b>
              {state.summary ? (
                <small>
                  {state.summary.totalRows.toLocaleString("ar-SA")} صف في الملف
                  {state.summary.batchId
                    ? ` · دفعة ${state.summary.batchId}`
                    : ""}
                </small>
              ) : null}
            </span>
          </div>

          {state.status === "success" && state.summary ? (
            <div className={styles.successGrid}>
              <article>
                <span>تم استيراده</span>
                <strong>
                  {state.summary.importedRows.toLocaleString("ar-SA")}
                </strong>
              </article>
              <article>
                <span>يحتاج مطابقة</span>
                <strong>
                  {state.summary.flaggedRows.toLocaleString("ar-SA")}
                </strong>
              </article>
              <button type="button" onClick={onImportAnother}>
                <RefreshCcw size={16} aria-hidden /> استيراد ملف آخر
              </button>
            </div>
          ) : null}

          {state.errors.length > 0 ? (
            <div className={styles.issueTable}>
              <div className={styles.issueHeader}>
                <span>الصف</span>
                <span>الحقل</span>
                <span>الخطأ</span>
              </div>
              {state.errors.map((issue, index) => (
                <div
                  className={styles.issueRow}
                  key={`${issue.row}-${issue.field}-${index}`}
                >
                  <code>{issue.row ?? "ملف"}</code>
                  <code dir="ltr">{issue.field}</code>
                  <span>{issue.message}</span>
                </div>
              ))}
              {state.errorCount > state.errors.length ? (
                <p>
                  إضافة إلى{" "}
                  {(state.errorCount - state.errors.length).toLocaleString(
                    "ar-SA",
                  )}{" "}
                  أخطاء أخرى. أصلح الملف على دفعات أصغر.
                </p>
              ) : null}
            </div>
          ) : null}

          {state.warnings.length > 0 ? (
            <details className={styles.warnings}>
              <summary>
                <AlertTriangle size={16} aria-hidden />
                {state.warningCount.toLocaleString("ar-SA")} صفًا مستوردًا يحتاج
                مطابقة كتالوج
              </summary>
              <ul>
                {state.warnings.map((issue, index) => (
                  <li key={`${issue.row}-${issue.field}-${index}`}>
                    الصف {issue.row}: {issue.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

export function CatalogImportGuardrail() {
  return (
    <aside className={styles.guardrail}>
      <ShieldCheck size={20} aria-hidden />
      <span>
        <b>ضوابط الاستيراد</b>
        <small>
          للمورد المعتمد فقط. نتحقق من الملف والتكرار وملكية المستودع قبل الحفظ،
          ونحفظ الدفعة كاملة أو نرفضها كاملة عند وجود خطأ. لا تُقبل صيغ الجداول
          التنفيذية.
        </small>
      </span>
    </aside>
  );
}
