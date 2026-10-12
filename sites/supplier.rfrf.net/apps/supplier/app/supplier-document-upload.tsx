'use client';

import { FileUp, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  SUPPLIER_DOCUMENT_TYPES,
  supplierDocumentTypeLabel,
} from '@rafraf/shared/supplier-document';

const ERROR_AR: Record<string, string> = {
  invalid_document:
    'الملف غير صالح. استخدم PDF أو JPG أو PNG بحجم لا يتجاوز 5 م.ب.',
  document_limit: 'وصلت للحد الأعلى لهذا النوع من المستندات.',
  storage_unavailable: 'تعذر حفظ الملف الآمن الآن. حاول مجددًا.',
  persistence_failed: 'تعذر ربط المستند بحساب المنشأة. حاول مجددًا.',
};

export function SupplierDocumentUpload() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch('/api/documents', {
        method: 'POST',
        body: new FormData(event.currentTarget),
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setMessage(
          ERROR_AR[body?.error ?? ''] ?? 'تعذر رفع المستند. حاول مجددًا.',
        );
        return;
      }
      setMessage('تم رفع المستند بأمان وإرساله للمراجعة.');
      event.currentTarget.reset();
      window.setTimeout(() => window.location.reload(), 500);
    } catch {
      setMessage('تعذر الاتصال بالخدمة. تحقق من الشبكة وحاول مجددًا.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="qform" onSubmit={submit} encType="multipart/form-data">
      <div className="qgrid">
        <label>
          نوع الوثيقة
          <select name="documentType" required defaultValue="">
            <option value="" disabled>
              اختر نوع الوثيقة
            </option>
            {SUPPLIER_DOCUMENT_TYPES.map((documentType) => (
              <option key={documentType} value={documentType}>
                {supplierDocumentTypeLabel(documentType)}
              </option>
            ))}
          </select>
        </label>
        <label>
          ملف الوثيقة
          <input
            name="file"
            type="file"
            required
            accept=".pdf,image/jpeg,image/png"
          />
        </label>
      </div>
      <button type="submit" disabled={pending}>
        <FileUp size={17} aria-hidden />
        {pending ? 'جارٍ الرفع الآمن…' : 'رفع وإرسال للمراجعة'}
      </button>
      <p className="qhint">
        <ShieldCheck size={15} aria-hidden /> الملف خاص، ولا يظهر إلا لمنشأتك
        وفريق الاعتماد المخوّل.
      </p>
      {message ? (
        <p className="sp-alert" role="status">
          {message}
        </p>
      ) : null}
    </form>
  );
}
