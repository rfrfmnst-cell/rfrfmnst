import { PaymentRefundStatus, type Prisma } from '@rafraf/db';
import {
  DUPLICATE_CAPTURE_FAILURE,
  DUPLICATE_PARTIAL_REFUND_FAILURE,
  FINANCIAL_RECONCILIATION_FAILURE,
  PARTIAL_REFUND_FAILURE,
  REFUND_SIGNAL_PENDING,
  isDuplicateCaptureFailure,
} from '@rafraf/orders';
import { Banknote, CreditCard, PackageCheck } from 'lucide-react';
import { refundEdfaPayPayment, resolveStaleEdfaPayIntake } from './actions';
import { money, timeAgo } from './command-center-format';
import {
  ar,
  ORDER_STATUS_AR,
  PAYMENT_REFUND_STATUS_AR,
  PAYOUT_STATUS_AR,
} from '../lib/admin-labels';

type RecentOrder = Prisma.OrderGetPayload<{
  include: {
    customer: { include: { user: true } };
    supplier: true;
  };
}>;

type PendingPayout = Prisma.SupplierPayoutGetPayload<{
  include: {
    supplier: { select: { businessName: true } };
    order: { select: { code: true; status: true } };
  };
}>;

type RefundablePayment = Prisma.PaymentGetPayload<{
  include: {
    order: { select: { code: true; status: true } };
    refunds: { select: { status: true; failureCode: true } };
  };
}>;

type StalePaymentIntake = Prisma.PaymentGetPayload<{
  select: {
    id: true;
    amount: true;
    currency: true;
    providerOrderCode: true;
    updatedAt: true;
    order: { select: { code: true; status: true } };
  };
}>;

interface CommandCenterFinanceProps {
  orders: RecentOrder[];
  pendingPayouts: PendingPayout[];
  refundablePayments: RefundablePayment[];
  criticalRefundCount: number;
  stalePaymentIntakes: StalePaymentIntake[];
  canManagePayments: boolean;
}

const REFUND_FAILURE_AR: Record<string, string> = {
  [FINANCIAL_RECONCILIATION_FAILURE]: 'تعارض مالي بعد حركة المورد — تصعيد فوري',
  [PARTIAL_REFUND_FAILURE]: 'استرداد جزئي — مصالحة مالية يدوية',
  [DUPLICATE_CAPTURE_FAILURE]: 'تحصيل مكرر — يجب رد الدفعة الزائدة',
  [DUPLICATE_PARTIAL_REFUND_FAILURE]:
    'تحصيل مكرر رُد جزئيًا — تحقّق فقط وأوقف الصرف',
  [REFUND_SIGNAL_PENDING]: 'إشعار استرداد موثّق قيد التأكيد',
};

export function CommandCenterFinance({
  orders,
  pendingPayouts,
  refundablePayments,
  criticalRefundCount,
  stalePaymentIntakes,
  canManagePayments,
}: CommandCenterFinanceProps) {
  return (
    <>
      <article className="ops-card span-12">
        <div className="ops-card-head">
          <div>
            <p>Orders</p>
            <h2>أوامر الشراء الأخيرة</h2>
          </div>
          <PackageCheck size={22} aria-hidden />
        </div>
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>الأمر</th>
                <th>العميل</th>
                <th>المورد</th>
                <th>الحالة</th>
                <th>القيمة</th>
                <th>آخر تحديث</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td className="mono">{order.code}</td>
                  <td>
                    {order.customer.fullName ||
                      order.customer.user.fullName ||
                      'عميل'}
                  </td>
                  <td>{order.supplier?.businessName ?? 'غير مرتبط'}</td>
                  <td>
                    <span className={`status o-${order.status}`}>
                      {ar(ORDER_STATUS_AR, order.status)}
                    </span>
                  </td>
                  <td>{money(Number(order.totalAmount))} ر.س</td>
                  <td>{timeAgo(order.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {orders.length === 0 ? (
            <p className="empty">لا توجد أوامر شراء بعد.</p>
          ) : null}
        </div>
      </article>

      <article className="ops-card span-12" id="payouts">
        <div className="ops-card-head">
          <div>
            <p>Supplier payouts</p>
            <h2>مستحقات الموردين — الصرف المالي موقوف</h2>
          </div>
          <Banknote size={22} aria-hidden />
        </div>
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>الطلب</th>
                <th>المورد</th>
                <th>المبلغ</th>
                <th>الحالة</th>
                <th>حالة مسار الصرف</th>
              </tr>
            </thead>
            <tbody>
              {pendingPayouts.map((payout) => (
                <tr key={payout.id}>
                  <td className="mono">{payout.order?.code ?? '—'}</td>
                  <td>{payout.supplier.businessName}</td>
                  <td>{money(Number(payout.amount))} ر.س</td>
                  <td>{ar(PAYOUT_STATUS_AR, payout.status)}</td>
                  <td>
                    <span className="ops-permission-note" role="status">
                      لا يمكن التسجيل كمدفوع: يلزم bank adapter، دليل تسوية
                      نهائي، واعتماد maker-checker من شخصين مختلفين.
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pendingPayouts.length === 0 ? (
            <p className="empty">لا توجد مستحقات معلّقة.</p>
          ) : null}
        </div>
      </article>

      <article className="ops-card span-12" id="payment-intake-recovery">
        <div className="ops-card-head">
          <div>
            <p>Unknown checkout outcomes</p>
            <h2>محاولات دفع معلّقة تحتاج تحقق EdfaPay</h2>
          </div>
          <span className="ops-pill">
            <CreditCard size={16} aria-hidden /> {stalePaymentIntakes.length}
          </span>
        </div>
        <p className="ops-permission-note">
          لا تُغلق المحاولة إلا بعد التأكد في لوحة EdfaPay أن رمز محاولة المزود
          لا يملك معاملة. أي callback متأخر سيبقى مربوطًا بهذه المحاولة ويُعالج
          كتحصيل مكرر عند الحاجة.
        </p>
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>الطلب</th>
                <th>رمز محاولة المزود</th>
                <th>المبلغ</th>
                <th>العمر</th>
                <th>إثبات المراجعة</th>
              </tr>
            </thead>
            <tbody>
              {stalePaymentIntakes.map((payment) => (
                <tr key={payment.id}>
                  <td className="mono">{payment.order.code}</td>
                  <td className="mono">{payment.providerOrderCode}</td>
                  <td>{money(Number(payment.amount))} ر.س</td>
                  <td>{timeAgo(payment.updatedAt)}</td>
                  <td>
                    {canManagePayments ? (
                      <form action={resolveStaleEdfaPayIntake}>
                        <input
                          type="hidden"
                          name="paymentId"
                          value={payment.id}
                        />
                        <input
                          name="confirmOrderCode"
                          required
                          autoComplete="off"
                          placeholder={`اكتب ${payment.order.code}`}
                          aria-label={`تأكيد الطلب ${payment.order.code}`}
                        />
                        <input
                          name="reviewReference"
                          required
                          minLength={10}
                          maxLength={120}
                          autoComplete="off"
                          placeholder="مرجع مراجعة EdfaPay"
                          aria-label={`مرجع مراجعة محاولة ${payment.providerOrderCode}`}
                        />
                        <button type="submit">تأكيد عدم وجود معاملة</button>
                      </form>
                    ) : (
                      <span className="ops-permission-note">
                        يتطلب PAYMENT_WRITE
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {stalePaymentIntakes.length === 0 ? (
            <p className="empty">لا توجد محاولات دفع معلّقة قديمة.</p>
          ) : null}
        </div>
      </article>

      <article className="ops-card span-12" id="refunds">
        <div className="ops-card-head">
          <div>
            <p>Payment refunds</p>
            <h2>الاسترداد الكامل قبل صرف المورد</h2>
          </div>
          <span className="ops-pill">{criticalRefundCount} حالات حرجة</span>
        </div>
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>الطلب</th>
                <th>المبلغ</th>
                <th>حالة الطلب</th>
                <th>حالة الاسترداد</th>
                <th>تأكيد وتنفيذ</th>
              </tr>
            </thead>
            <tbody>
              {refundablePayments.map((payment) => {
                const operation = payment.refunds[0];
                const duplicateCapture = isDuplicateCaptureFailure(
                  operation?.failureCode ?? null,
                );
                const manualReconciliation =
                  operation?.failureCode === FINANCIAL_RECONCILIATION_FAILURE ||
                  operation?.failureCode === PARTIAL_REFUND_FAILURE;
                const actionAllowed =
                  !operation ||
                  duplicateCapture ||
                  operation.status === PaymentRefundStatus.PROCESSING ||
                  operation.status === PaymentRefundStatus.PROVIDER_PENDING;
                return (
                  <tr key={payment.id}>
                    <td className="mono">{payment.order.code}</td>
                    <td>{money(Number(payment.amount))} ر.س</td>
                    <td>{ar(ORDER_STATUS_AR, payment.order.status)}</td>
                    <td aria-live="polite">
                      {operation?.failureCode
                        ? (REFUND_FAILURE_AR[operation.failureCode] ??
                          ar(PAYMENT_REFUND_STATUS_AR, operation.status))
                        : ar(
                            PAYMENT_REFUND_STATUS_AR,
                            operation?.status,
                            'لم يُطلب',
                          )}
                    </td>
                    <td>
                      {canManagePayments &&
                      actionAllowed &&
                      !manualReconciliation ? (
                        <form action={refundEdfaPayPayment}>
                          <input
                            type="hidden"
                            name="paymentId"
                            value={payment.id}
                          />
                          <input
                            name="confirmOrderCode"
                            required
                            autoComplete="off"
                            placeholder={`اكتب ${payment.order.code}`}
                            aria-label={`تأكيد استرداد ${payment.order.code}`}
                          />
                          <button type="submit">
                            {duplicateCapture
                              ? operation?.status ===
                                PaymentRefundStatus.REQUESTED
                                ? 'رد التحصيل المكرر'
                                : 'تحقق من رد التحصيل المكرر'
                              : operation
                                ? 'تحقق من المزوّد'
                                : 'استرداد كامل'}
                          </button>
                        </form>
                      ) : !canManagePayments ? (
                        <span className="ops-permission-note">
                          يتطلب PAYMENT_WRITE
                        </span>
                      ) : manualReconciliation ? (
                        <span className="ops-permission-note">
                          أوقف الصرف وراجع سجل المزوّد والدفتر المالي
                        </span>
                      ) : (
                        <span>تتطلب مراجعة مالية</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {refundablePayments.length === 0 ? (
            <p className="empty">لا توجد دفعات مؤهلة للاسترداد.</p>
          ) : null}
        </div>
      </article>
    </>
  );
}
