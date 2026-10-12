import { ArrowLeft, CircleDollarSign, Headphones, Truck } from 'lucide-react';
import Link from 'next/link';
import {
  CUSTOMER_DISPUTE_REASONS,
  type CustomerDisputeReason,
} from '@rafraf/orders';
import { SubmitButton } from '@rafraf/ui/submit-button';
import {
  DISPUTE_STATUS_AR,
  ORDER_STATUS_AR,
  REFUND_STATUS_AR,
} from './account-status';
import styles from './account-styles';
import {
  CUSTOMER_ACCOUNT_DATE,
  type CustomerDashboardOrder,
  customerPaymentLabel,
  customerShipmentLabel,
  customerStatusTone,
  formatCustomerMoney,
} from './customer-dashboard-model';
import dashboardStyles from './customer-dashboard-styles';
import { openCustomerOrderDispute } from './dispute-actions';
import disputeStyles from './dispute.module.css';
import { confirmOrderReceipt } from './receipt-actions';
import type { CustomerPaymentExperience } from '../../lib/payments/payment-launch';
import { cancelCustomerAwaitingPaymentOrder } from '../actions';
import { canCancelDeferredCustomerOrder } from '../../lib/customer-order';

export function CustomerDashboardOrderCard({
  order,
  paymentExperience,
}: {
  order: CustomerDashboardOrder;
  paymentExperience: CustomerPaymentExperience;
}) {
  const paymentStatus =
    order.payment && order.payment.provider !== 'MOCK'
      ? order.payment.status
      : order.status;
  const shipmentStatus =
    order.shipment && order.shipment.provider !== 'MOCK'
      ? order.shipment.status
      : order.status;
  const refund =
    order.refund && order.refund.provider !== 'MOCK' ? order.refund : null;
  const trackingNumber =
    order.shipment && order.shipment.provider !== 'MOCK'
      ? order.shipment.trackingNumber
      : null;

  return (
    <article className={dashboardStyles.orderCard}>
      <header className={dashboardStyles.orderHeader}>
        <div>
          <span className={dashboardStyles.orderEyebrow}>
            <bdi dir="ltr">{order.code}</bdi> ·{' '}
            {CUSTOMER_ACCOUNT_DATE.format(order.createdAt)}
          </span>
          <h3>{order.partText ?? 'قطعة غيار'}</h3>
        </div>
        <span
          className={dashboardStyles.statusBadge}
          data-tone={customerStatusTone(order.status)}
        >
          {ORDER_STATUS_AR[order.status] ?? order.status}
        </span>
      </header>

      <dl className={dashboardStyles.orderStateGrid}>
        <div>
          <dt>
            <CircleDollarSign size={16} aria-hidden /> الدفع
          </dt>
          <dd data-tone={customerStatusTone(paymentStatus)}>
            {customerPaymentLabel(order, paymentExperience)}
          </dd>
        </div>
        <div>
          <dt>
            <Truck size={16} aria-hidden /> الشحن
          </dt>
          <dd data-tone={customerStatusTone(shipmentStatus)}>
            {customerShipmentLabel(order)}
          </dd>
          {trackingNumber ? (
            <small>
              تتبع: <bdi dir="ltr">{trackingNumber}</bdi>
            </small>
          ) : null}
        </div>
        <div>
          <dt>
            <Headphones size={16} aria-hidden /> الدعم والاسترداد
          </dt>
          <dd
            data-tone={customerStatusTone(
              refund?.status ?? order.dispute?.status ?? 'CLEAR',
            )}
          >
            {refund
              ? (REFUND_STATUS_AR[refund.status] ?? 'استرداد مسجّل')
              : order.dispute
                ? (DISPUTE_STATUS_AR[order.dispute.status] ?? 'شكوى مسجّلة')
                : 'لا توجد شكوى مفتوحة'}
          </dd>
          {refund ? (
            <small>{formatCustomerMoney(refund.amount, refund.currency)}</small>
          ) : null}
        </div>
      </dl>

      <footer className={dashboardStyles.orderFooter}>
        <strong>
          {formatCustomerMoney(order.totalAmount, order.currency)}
        </strong>
        <div className={disputeStyles.orderActions}>
          {canCancelDeferredCustomerOrder({
            orderStatus: order.status,
            paymentKind: paymentExperience.kind,
            activePayment: order.activePayment,
          }) ? (
            <form action={cancelCustomerAwaitingPaymentOrder}>
              <input type="hidden" name="orderId" value={order.id} />
              <SubmitButton
                className={styles.track}
                pendingLabel="جارٍ الإلغاء…"
              >
                إلغاء الطلب
              </SubmitButton>
            </form>
          ) : null}
          {order.status === 'COMPLAINT_WINDOW' && !order.customerConfirmedAt ? (
            <form action={confirmOrderReceipt}>
              <input type="hidden" name="orderId" value={order.id} />
              <SubmitButton
                className={styles.confirm}
                pendingLabel="جارٍ التأكيد…"
              >
                تأكيد الاستلام
              </SubmitButton>
            </form>
          ) : null}
          {order.status === 'COMPLAINT_WINDOW' ? (
            <details className={disputeStyles.disputeDetails}>
              <summary>فتح شكوى</summary>
              <form
                action={openCustomerOrderDispute}
                className={disputeStyles.disputeForm}
              >
                <input type="hidden" name="orderId" value={order.id} />
                <label>
                  <span>سبب الشكوى</span>
                  <select name="reasonCode" required>
                    {Object.entries(CUSTOMER_DISPUTE_REASONS).map(
                      ([value, label]) => (
                        <option
                          key={value}
                          value={value as CustomerDisputeReason}
                        >
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  <span>وصف ما حدث</span>
                  <textarea
                    name="description"
                    minLength={10}
                    maxLength={1000}
                    rows={3}
                    required
                  />
                </label>
                <SubmitButton
                  className={disputeStyles.disputeSubmit}
                  pendingLabel="جارٍ فتح الشكوى…"
                >
                  إيقاف التسوية وفتح الشكوى
                </SubmitButton>
              </form>
            </details>
          ) : null}
          <Link
            href={`/track?code=${encodeURIComponent(order.code)}`}
            className={styles.track}
          >
            {order.status === 'AWAITING_PAYMENT' &&
            paymentExperience.kind === 'checkout'
              ? 'الدفع والمتابعة'
              : 'التفاصيل والتتبع'}
            <ArrowLeft size={14} aria-hidden />
          </Link>
        </div>
      </footer>
    </article>
  );
}
