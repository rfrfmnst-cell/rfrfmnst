import { notFound } from 'next/navigation';
import { prisma } from '@rafraf/db';
import { PrintButton } from './print-button';
import { requireAdminPermission } from '../../../lib/require-admin-session';

export const dynamic = 'force-dynamic';

/** فاتورة مبدئية/أمر شراء للطباعة — بيانات العميل والسعر النهائي فقط
 *  (Rule 2: لا مورد، لا تكلفة، لا هامش على أي مستند يُسلَّم للعميل). */

function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const PAY_METHOD_AR: Record<string, string> = {
  MANUAL_BANK_TRANSFER: 'تحويل بنكي',
  MANUAL_COD: 'الدفع عند الاستلام',
  MOCK: 'تجريبي',
};

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  await requireAdminPermission('OPERATIONS_READ');
  const { code } = await params;
  const order = await prisma.order.findUnique({
    where: { code },
    include: {
      customer: { include: { user: true } },
      quote: { include: { rfqItem: true } },
      rfq: { include: { vehicle: true } },
      payments: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!order) notFound();

  const paid = order.payments.some((p) =>
    ['CAPTURED', 'HELD', 'RELEASED'].includes(p.status),
  );
  const payMethod = order.payments[0]
    ? (PAY_METHOD_AR[order.payments[0].provider] ?? order.payments[0].provider)
    : null;
  const vehicle = order.rfq?.vehicle;
  const total = Number(order.totalAmount).toFixed(2);

  return (
    <>
      <div className="inv-actions">
        <a href={order.rfq ? `/rfq/${order.rfq.id}` : '/'} className="back">
          ← رجوع للطلب
        </a>
        <PrintButton />
      </div>

      <article className="inv-sheet">
        <header className="inv-head">
          <div>
            <div className="inv-brand">رفرف</div>
            <div className="inv-doc-type">أمر شراء / فاتورة مبدئية</div>
          </div>
          <div className="inv-meta mono" dir="ltr">
            <div>{order.code}</div>
            <div>{fmtDate(order.createdAt)}</div>
          </div>
        </header>

        <section className="inv-section">
          <h3>العميل</h3>
          <p>
            {order.customer.fullName}
            {order.customer.city ? ` — ${order.customer.city}` : ''}
            <br />
            <span className="mono" dir="ltr">
              {order.customer.user.phone}
            </span>
          </p>
        </section>

        <section className="inv-section">
          <h3>البيان</h3>
          <table className="inv-table">
            <thead>
              <tr>
                <th>الصنف</th>
                <th>المركبة</th>
                <th className="center">الكمية</th>
                <th>الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{order.quote.rfqItem.freeTextAr ?? 'قطعة غيار'}</td>
                <td>
                  {vehicle
                    ? `${vehicle.make} ${vehicle.model} ${vehicle.year}`
                    : '—'}
                </td>
                <td className="center">{order.quote.rfqItem.quantity}</td>
                <td className="mono">{total} ر.س</td>
              </tr>
            </tbody>
          </table>
          <div className="inv-total">
            <span>الإجمالي المستحق</span>
            <span className="mono">{total} ر.س</span>
          </div>
        </section>

        <section className="inv-section">
          <h3>حالة الدفع</h3>
          <p>
            <span className={`inv-badge ${paid ? 'paid' : 'unpaid'}`}>
              {paid
                ? 'مدفوع'
                : order.status === 'AWAITING_PAYMENT'
                  ? 'بانتظار الدفع'
                  : 'غير مدفوع'}
            </span>
            {payMethod ? (
              <span className="inv-pay-method">طريقة الدفع: {payMethod}</span>
            ) : null}
          </p>
        </section>

        <p className="inv-note">
          هذه فاتورة مبدئية لأغراض التأكيد والمتابعة — فاتورة ضريبية رسمية تصدر
          لاحقاً. السعر نهائي شامل التوصيل والضريبة.
        </p>
      </article>
    </>
  );
}
