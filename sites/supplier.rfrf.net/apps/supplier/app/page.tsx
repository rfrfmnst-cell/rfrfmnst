import { canSupplierReceiveRfqs } from '@rafraf/shared';
import { ShieldCheck } from 'lucide-react';
import { redirect } from 'next/navigation';
import { supplierSourcingAccessNotice } from '../lib/supplier-access';
import { getSessionSupplierId } from '../lib/session';
import { SupplierDashboardView } from './supplier-dashboard-view';
import { SupplierCommerceReviewNotice } from './supplier-commerce-review-notice';
import { SupplierDocumentUpload } from './supplier-document-upload';
import {
  ar,
  DOCUMENT_STATUS_AR,
  DOCUMENT_TYPE_AR,
} from '../lib/supplier-labels';
import {
  loadSupplierAccount,
  loadSupplierDashboardReadModel,
} from './supplier-dashboard-read-model';

export const dynamic = 'force-dynamic';

const ERR_AR: Record<string, string> = {
  name: 'اسم المنشأة مطلوب.',
  city: 'اسم المدينة غير صالح أو أطول من الحد المسموح.',
  country: 'أدخل رمز الدولة من حرفين، مثل SA أو AE أو DE أو US.',
  registration: 'رقم التسجيل القانوني للمنشأة مطلوب.',
  phone: 'أدخل جوالاً دولياً صحيحاً يبدأ بعلامة + ورمز الدولة.',
  price: 'سعر القطعة غير صالح.',
  days: 'مدة التوريد بالأيام غير صالحة (1–365).',
  warranty: 'الضمان بالشهور غير صالح (0–120).',
  rfq: 'الطلب لم يعد متاحاً للتسعير.',
  dup: 'سبق أن قدّمت عرضاً على هذا الطلب.',
  save: 'تعذّر الحفظ — حاول مرة أخرى.',
  rate: 'طلبات تسجيل كثيرة. انتظر قليلًا ثم أعد المحاولة.',
  verification: 'تعذّر إكمال التحقق البشري. حدّث الصفحة وحاول مرة أخرى.',
  delivery: 'تعذّر إرسال رمز التحقق. حاول مرة أخرى لاحقًا.',
  nosup: 'المنشأة غير موجودة — اختر من القائمة أو سجّل من جديد.',
};

export default async function SupplierPortal({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; ok?: string; register?: string }>;
}) {
  const { err, ok, register } = await searchParams;
  if (register) redirect('/login?mode=register');

  const supplierId = await getSessionSupplierId();

  if (!supplierId) redirect('/login');

  const supplier = await loadSupplierAccount(supplierId);

  const errMsg = err
    ? (ERR_AR[err] ?? ERR_AR.save)
    : !supplier
      ? ERR_AR.nosup
      : null;

  if (!supplier) redirect('/login');

  if (!canSupplierReceiveRfqs(supplier.status)) {
    return (
      <>
        <section className="card-block sp-pending-state">
          <ShieldCheck size={34} aria-hidden />
          <h1>{supplier.businessName}</h1>
          <p className="sp-alert ok">
            {supplierSourcingAccessNotice(supplier.status)}
          </p>
          <form action="/login/logout" method="POST">
            <button type="submit">خروج</button>
          </form>
        </section>
        <section className="card-block sp-register">
          <h2>وثيقة المنشأة</h2>
          <p className="sub">
            أرفق السجل أو الرخصة التجارية الصادرة في بلدك، أو وثيقة العمل الحر
            حيث تنطبق، لإكمال التسجيل وبدء مراجعة الحساب.
          </p>
          <SupplierDocumentUpload />
          {supplier.documents.length ? (
            <ul className="sp-list">
              {supplier.documents.map((document) => (
                <li key={document.id}>
                  <a
                    href={`/api/documents?id=${encodeURIComponent(document.id)}`}
                  >
                    {ar(DOCUMENT_TYPE_AR, document.type)}
                  </a>{' '}
                  · {ar(DOCUMENT_STATUS_AR, document.status)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="qhint">لم تُرفع وثيقة مؤهلة بعد.</p>
          )}
        </section>
      </>
    );
  }

  const dashboard = await loadSupplierDashboardReadModel(supplier);

  return (
    <>
      <SupplierCommerceReviewNotice supplierId={supplier.id} />
      <SupplierDashboardView
        data={dashboard}
        errMsg={errMsg}
        ok={ok}
        supplier={supplier}
      />
    </>
  );
}
