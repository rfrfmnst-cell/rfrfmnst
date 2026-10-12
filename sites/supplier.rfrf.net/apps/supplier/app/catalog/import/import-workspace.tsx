'use client';

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
} from 'lucide-react';
import { useActionState, useRef, useState } from 'react';
import { importSupplierCatalog } from './actions';
import {
  CATALOG_HEADERS,
  type CatalogImportState,
  type CatalogWarehouseOption,
  INITIAL_CATALOG_IMPORT_STATE,
  MAX_CATALOG_FILE_BYTES,
  MAX_CATALOG_ROWS,
} from './catalog-import';
import {
  CatalogImportFeedback,
  CatalogImportGuardrail,
} from './import-feedback';
import styles from './import.module.css';

const STEPS = [
  { number: 1, label: 'رفع الملف', detail: 'CSV مشفّر UTF-8' },
  { number: 2, label: 'التحقق', detail: 'العناوين والأنواع' },
  { number: 3, label: 'المراجعة', detail: 'الأخطاء والتكرار' },
  { number: 4, label: 'الاستيراد', detail: 'حفظ ذري ومدقّق' },
] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} كيلوبايت`;
}

function newClientToken(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function quoteCsv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function downloadTemplate(warehouses: CatalogWarehouseOption[]) {
  const defaultWarehouse = warehouses.find((warehouse) => warehouse.isDefault);
  const example = [
    '90915-YZZD2',
    'Toyota',
    'NEW',
    '12',
    '45.50',
    'SAR',
    '12',
    '2',
    defaultWarehouse?.name ?? '',
  ];
  const csv = `\uFEFF${CATALOG_HEADERS.join(',')}\r\n${example
    .map(quoteCsv)
    .join(',')}\r\n`;
  const url = URL.createObjectURL(
    new Blob([csv], { type: 'text/csv;charset=utf-8' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'rafraf-catalog-template.csv';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function currentPhase(
  file: File | null,
  pending: boolean,
  state: CatalogImportState,
): number {
  if (pending) return 2;
  if (state.status === 'success') return 4;
  if (state.status === 'validation_error' || state.status === 'error') return 3;
  return file ? 2 : 1;
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
  const [clientToken, setClientToken] = useState('');
  const [clientError, setClientError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stateIsCurrent = Boolean(
    clientToken && state.clientToken === clientToken,
  );
  const visibleState = stateIsCurrent ? state : INITIAL_CATALOG_IMPORT_STATE;
  const phase = currentPhase(selectedFile, pending, visibleState);
  const maxFileLabel = `${Math.floor(MAX_CATALOG_FILE_BYTES / 1024)} كيلوبايت`;

  const handleFile = (file: File | null) => {
    setSelectedFile(file);
    setClientToken(newClientToken());
    if (!file) {
      setClientError(null);
      return;
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setClientError('امتداد الملف يجب أن يكون .csv');
      return;
    }
    if (file.size === 0) {
      setClientError('الملف فارغ.');
      return;
    }
    if (file.size > MAX_CATALOG_FILE_BYTES) {
      setClientError(`حجم الملف يتجاوز الحد ${maxFileLabel}.`);
      return;
    }
    setClientError(null);
  };

  return (
    <div className={styles.workspace}>
      <section className={styles.metrics} aria-label="ملخص المخزون والاستيراد">
        <article>
          <Database size={19} aria-hidden />
          <span>المخزون الحالي</span>
          <strong>{currentInventoryCount.toLocaleString('ar-SA')}</strong>
          <small>صف نشط للمنشأة</small>
        </article>
        <article className={styles.flaggedMetric}>
          <AlertTriangle size={19} aria-hidden />
          <span>بانتظار المطابقة</span>
          <strong>{flaggedInventoryCount.toLocaleString('ar-SA')}</strong>
          <small>صف يحتاج مراجعة كتالوج</small>
        </article>
        <article>
          <Warehouse size={19} aria-hidden />
          <span>المستودعات</span>
          <strong>{warehouses.length.toLocaleString('ar-SA')}</strong>
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
            <p>RAFRAF CATALOG · CONTROLLED IMPORT</p>
            <h1 id="catalog-import-title">استيراد كتالوج {supplierName}</h1>
            <span>
              ملف واحد، تحقق كامل، ثم حفظ كل الصفوف أو لا شيء داخل معاملة واحدة.
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
                  active ? styles.stepActive : done ? styles.stepDone : ''
                }
                aria-current={active ? 'step' : undefined}
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
            <legend className={styles.srOnly}>اختيار ملف كتالوج CSV</legend>
            <label
              className={`${styles.dropzone} ${clientError ? styles.dropzoneError : ''}`}
              htmlFor="catalog-file"
            >
              <input
                ref={inputRef}
                id="catalog-file"
                name="catalogFile"
                type="file"
                accept=".csv,text/csv"
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
                  {selectedFile ? selectedFile.name : 'اختر ملف CSV للبدء'}
                </strong>
                <p id="catalog-file-help">
                  UTF-8 · بحد أقصى {maxFileLabel} · حتى {MAX_CATALOG_ROWS} صف
                </p>
              </div>
              <span className={styles.chooseButton}>اختيار ملف</span>
            </label>

            <p
              id="catalog-file-error"
              className={styles.clientError}
              role="alert"
            >
              {clientError ?? ''}
            </p>

            {selectedFile ? (
              <div className={styles.fileSummary} aria-live="polite">
                <FileText size={19} aria-hidden />
                <span>
                  <b>{selectedFile.name}</b>
                  <small>
                    {formatBytes(selectedFile.size)} ·{' '}
                    {selectedFile.type || 'text/csv'}
                  </small>
                </span>
                <CheckCircle2 size={19} aria-hidden />
              </div>
            ) : null}

            <div className={styles.contract}>
              <div>
                <FileCheck2 size={19} aria-hidden />
                <span>
                  <b>عقد الأعمدة</b>
                  <small>
                    الإلزامي: part_number, price, quantity. بقية الأعمدة
                    اختيارية.
                  </small>
                </span>
              </div>
              <button
                type="button"
                onClick={() => downloadTemplate(warehouses)}
              >
                <Download size={16} aria-hidden /> تنزيل القالب
              </button>
            </div>

            <div className={styles.actions}>
              <span>
                لن تُحفظ الصفوف التي تحتوي أخطاء أو تكرار، ولا تُحفظ بقية الدفعة
                معها.
              </span>
              <button
                className={styles.submit}
                type="submit"
                disabled={!selectedFile || Boolean(clientError) || pending}
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
                    <ShieldCheck size={17} aria-hidden /> تحقق ثم استورد
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
