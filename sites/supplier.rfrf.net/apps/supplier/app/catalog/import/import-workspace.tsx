"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileCheck2,
  FileText,
  LoaderCircle,
  ShieldCheck,
  Upload,
  Warehouse,
} from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { importSupplierCatalog } from "./actions";
import {
  type CatalogImportIssue,
  type CatalogImportState,
  type CatalogWarehouseOption,
  INITIAL_CATALOG_IMPORT_STATE,
  MAX_CATALOG_FILE_BYTES,
  MAX_CATALOG_ROWS,
} from "./catalog-import";
import {
  parseCatalogUpload,
  type ParsedCatalogUpload,
} from "./catalog-import-parser";
import {
  buildCatalogTemplate,
  type CatalogTemplateFormat,
} from "./catalog-import-template";
import {
  CatalogImportFeedback,
  CatalogImportGuardrail,
} from "./import-feedback";
import styles from "./import.module.css";

const STEPS = [
  { number: 1, label: "رفع الملف", detail: "CSV / TSV / TXT · UTF-8" },
  { number: 2, label: "التحقق", detail: "العناوين والأنواع" },
  { number: 3, label: "المعاينة", detail: "راجع القيم قبل الحفظ" },
  { number: 4, label: "الاستيراد", detail: "تحقق وحفظ الدفعة" },
] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} كيلوبايت`;
}

function newClientToken(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function downloadTemplate(
  warehouses: CatalogWarehouseOption[],
  format: CatalogTemplateFormat = "csv",
) {
  const content = buildCatalogTemplate(warehouses, format);
  const url = URL.createObjectURL(
    new Blob([content], {
      type: `${format === "tsv" ? "text/tab-separated-values" : "text/csv"};charset=utf-8`,
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `rafraf-catalog-template.${format}`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function currentPhase(
  file: File | null,
  pending: boolean,
  state: CatalogImportState,
  ready: boolean,
): number {
  if (pending) return 4;
  if (state.status === "success") return 4;
  if (state.status === "validation_error" || state.status === "error") return 3;
  return ready ? 3 : file ? 2 : 1;
}

export function CatalogImportWorkspace({
  supplierName,
  currentInventoryCount,
  flaggedInventoryCount,
  warehouses,
}: {
  supplierName: string;
  currentInventoryCount: number;
  flaggedInventoryCount: number;
  warehouses: CatalogWarehouseOption[];
}) {
  const [state, formAction, pending] = useActionState(
    importSupplierCatalog,
    INITIAL_CATALOG_IMPORT_STATE,
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [clientToken, setClientToken] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const [clientIssues, setClientIssues] = useState<CatalogImportIssue[]>([]);
  const [checkingFile, setCheckingFile] = useState(false);
  const [preview, setPreview] = useState<Extract<
    ParsedCatalogUpload,
    { ok: true }
  > | null>(null);
  const selectionRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const stateIsCurrent = Boolean(
    clientToken && state.clientToken === clientToken,
  );
  const visibleState = stateIsCurrent ? state : INITIAL_CATALOG_IMPORT_STATE;
  const phase = currentPhase(
    selectedFile,
    pending,
    visibleState,
    Boolean(preview),
  );
  const maxFileLabel = `${Math.floor(MAX_CATALOG_FILE_BYTES / 1024)} كيلوبايت`;

  const handleFile = async (file: File | null) => {
    const selection = ++selectionRef.current;
    const token = newClientToken();
    setSelectedFile(file);
    setClientToken(token);
    setPreview(null);
    setClientIssues([]);
    setClientError(null);
    setCheckingFile(Boolean(file));
    if (!file) {
      return;
    }
    const parsed = await parseCatalogUpload(file, token, {
      maxFileBytes: MAX_CATALOG_FILE_BYTES,
      maxRows: MAX_CATALOG_ROWS,
    });
    if (selection !== selectionRef.current) return;
    setCheckingFile(false);
    if (parsed.ok) setPreview(parsed);
    else {
      setClientError("لم يُحفظ شيء. أصلح الأخطاء التالية ثم أعد اختيار الملف.");
      setClientIssues(parsed.state.errors);
    }
  };

  return (
    <div className={styles.workspace}>
      <section className={styles.metrics} aria-label="ملخص المخزون والاستيراد">
        <article>
          <Database size={19} aria-hidden />
          <span>المخزون الحالي</span>
          <strong>{currentInventoryCount.toLocaleString("ar-SA")}</strong>
          <small>صف نشط للمنشأة</small>
        </article>
        <article className={styles.flaggedMetric}>
          <AlertTriangle size={19} aria-hidden />
          <span>بانتظار المطابقة</span>
          <strong>{flaggedInventoryCount.toLocaleString("ar-SA")}</strong>
          <small>صف يحتاج مراجعة كتالوج</small>
        </article>
        <article>
          <Warehouse size={19} aria-hidden />
          <span>المستودعات</span>
          <strong>{warehouses.length.toLocaleString("ar-SA")}</strong>
          <small>يُستخدم الافتراضي عند ترك الحقل فارغًا</small>
        </article>
      </section>

      <section
        className={styles.importCard}
        aria-labelledby="catalog-import-title"
      >
        <div className={styles.spectrum} aria-hidden />
        <header className={styles.cardHeader}>
          <div>
            <p>كتالوج رفرف</p>
            <h1 id="catalog-import-title">استيراد كتالوج {supplierName}</h1>
            <span>
              ارفع ملف المخزون وراجع المعاينة، ثم أكّد استيراد الدفعة.
            </span>
          </div>
          <ShieldCheck size={28} aria-hidden />
        </header>

        <ol className={styles.steps} aria-label="مراحل استيراد الكتالوج">
          {STEPS.map((step) => {
            const active = phase === step.number;
            const done = phase > step.number;
            return (
              <li
                key={step.number}
                className={
                  active ? styles.stepActive : done ? styles.stepDone : ""
                }
                aria-current={active ? "step" : undefined}
              >
                <span>
                  {done ? <CheckCircle2 size={17} aria-hidden /> : step.number}
                </span>
                <div>
                  <b>{step.label}</b>
                  <small>{step.detail}</small>
                </div>
              </li>
            );
          })}
        </ol>

        <form action={formAction} className={styles.form}>
          <input type="hidden" name="clientToken" value={clientToken} />
          <fieldset disabled={pending}>
            <legend className={styles.srOnly}>
              اختيار ملف كتالوج CSV أو TSV أو TXT
            </legend>
            <label
              className={`${styles.dropzone} ${clientError ? styles.dropzoneError : ""}`}
              htmlFor="catalog-file"
            >
              <input
                ref={inputRef}
                id="catalog-file"
                name="catalogFile"
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                required
                aria-describedby="catalog-file-help catalog-file-error"
                aria-invalid={Boolean(clientError)}
                onChange={(event) =>
                  handleFile(event.currentTarget.files?.[0] ?? null)
                }
              />
              <span className={styles.uploadIcon}>
                <Upload size={25} aria-hidden />
              </span>
              <div>
                <strong>
                  {selectedFile ? selectedFile.name : "اختر ملف المخزون للبدء"}
                </strong>
                <p id="catalog-file-help">
                  UTF-8 · بحد أقصى {maxFileLabel} · حتى {MAX_CATALOG_ROWS} صف
                </p>
              </div>
              <span className={styles.chooseButton}>اختيار ملف</span>
            </label>

            <p className={styles.fileInstructions}>
              يدعم CSV بالفاصلة أو الفاصلة المنقوطة، وTSV أو TXT المفصول بعلامة
              تبويب. لملفات Excel اختر «حفظ باسم ← CSV UTF-8»؛ XLSX وXLS غير
              مدعومين حاليًا. اضبط عمود رقم القطعة كنص قبل التصدير للحفاظ على
              الأصفار الأولى؛ لا يمكن استعادتها إذا حذفها Excel.
            </p>

            <p
              id="catalog-file-error"
              className={styles.clientError}
              role="alert"
            >
              {clientError ?? ""}
            </p>
            {clientIssues.length > 0 ? (
              <ul className={styles.validationIssues}>
                {clientIssues.map((issue, index) => (
                  <li key={`${issue.row}-${issue.field}-${index}`}>
                    {issue.row ? `الصف ${issue.row}` : "الملف"} ·{" "}
                    <bdi>{issue.field}</bdi>: {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
            {checkingFile ? (
              <p role="status">جارٍ قراءة الملف وتجهيز المعاينة…</p>
            ) : null}

            {selectedFile ? (
              <div className={styles.fileSummary} aria-live="polite">
                <FileText size={19} aria-hidden />
                <span>
                  <b>{selectedFile.name}</b>
                  <small>
                    {formatBytes(selectedFile.size)} ·{" "}
                    {selectedFile.type || "text/csv"}
                  </small>
                </span>
                {preview ? <CheckCircle2 size={19} aria-hidden /> : null}
              </div>
            ) : null}

            <div className={styles.contract}>
              <div>
                <FileCheck2 size={19} aria-hidden />
                <span>
                  <b>أعمدة الملف</b>
                  <small>
                    الإلزامي: part_number, price, quantity. بقية الأعمدة
                    اختيارية. تُقبل أيضًا «رقم القطعة، السعر، الكمية» أو OEM/SKU
                    وqty. استخدم عمودًا واحدًا لرقم القطعة؛ لا تجمع OEM وSKU
                    كعمودين مستقلين.
                  </small>
                </span>
              </div>
              <button
                type="button"
                onClick={() => downloadTemplate(warehouses)}
              >
                <Download size={16} aria-hidden /> قالب CSV
              </button>
              <button
                type="button"
                onClick={() => downloadTemplate(warehouses, "tsv")}
              >
                <Download size={16} aria-hidden /> قالب TSV
              </button>
            </div>

            {preview ? (
              <section
                className={styles.preview}
                aria-label="معاينة البيانات قبل الاستيراد"
              >
                <h2>
                  معاينة قبل الحفظ ·{" "}
                  {preview.rows.length.toLocaleString("ar-SA")} صف
                </h2>
                <p>
                  لم تُحفظ البيانات بعد. يعرض الجدول أول 8 صفوف بعد فحص جميع
                  صفوف الملف. عند التأكيد يُفحص التكرار والمستودع على الخادم.
                </p>
                <div className={styles.previewTable}>
                  <table>
                    <thead>
                      <tr>
                        <th>الصف</th>
                        <th>رقم القطعة</th>
                        <th>الماركة</th>
                        <th>الكمية</th>
                        <th>السعر</th>
                        <th>العملة</th>
                        <th>المستودع</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 8).map((row) => (
                        <tr key={row.row}>
                          <td>{row.row}</td>
                          <td>
                            <bdi>{row.partNumber}</bdi>
                          </td>
                          <td>{row.brand ?? "—"}</td>
                          <td>{row.quantity}</td>
                          <td>
                            <bdi>{row.price}</bdi>
                          </td>
                          <td>{row.currency}</td>
                          <td>{row.warehouseRef ?? "الافتراضي"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            <div className={styles.actions}>
              <span>
                لن تُحفظ الصفوف التي تحتوي أخطاء أو تكرار، ولا تُحفظ بقية الدفعة
                معها.
              </span>
              <button
                className={styles.submit}
                type="submit"
                disabled={
                  !preview ||
                  Boolean(clientError) ||
                  checkingFile ||
                  pending ||
                  visibleState.status === "success"
                }
              >
                {pending ? (
                  <>
                    <LoaderCircle
                      className={styles.spinner}
                      size={17}
                      aria-hidden
                    />
                    جارٍ التحقق والاستيراد…
                  </>
                ) : (
                  <>
                    <ShieldCheck size={17} aria-hidden /> تأكيد استيراد{" "}
                    {preview?.rows.length ?? 0} صف
                  </>
                )}
              </button>
            </div>
          </fieldset>
        </form>

        <CatalogImportFeedback
          pending={pending}
          state={visibleState}
          onImportAnother={() => inputRef.current?.click()}
        />
      </section>

      <CatalogImportGuardrail />
    </div>
  );
}
