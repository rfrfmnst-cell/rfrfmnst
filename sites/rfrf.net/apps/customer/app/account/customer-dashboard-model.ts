import {
  ORDER_STATUS_AR,
  PAYMENT_STATUS_AR,
  READY_ORDER_STATUSES,
  SHIPMENT_STATUS_AR,
  SHIPPING_ORDER_STATUSES,
} from './account-status';
import type { CustomerPaymentExperience } from '../../lib/payments/payment-launch';

export interface CustomerDashboardOrder {
  id: string;
  code: string;
  status: string;
  totalAmount: number;
  currency: string;
  createdAt: Date;
  customerConfirmedAt: Date | null;
  partText: string | null;
  payment: { provider: string; status: string } | null;
  activePayment: boolean;
  refund: {
    provider: string;
    status: string;
    amount: number;
    currency: string;
  } | null;
  shipment: {
    provider: string;
    status: string;
    trackingNumber: string | null;
  } | null;
  dispute: { status: string } | null;
}

export interface CustomerDashboardRfq {
  id: string;
  code: string;
  status: string;
  createdAt: Date;
  partText: string | null;
}

export interface CustomerDashboardProps {
  customerName: string;
  orders: CustomerDashboardOrder[];
  orderCount: number;
  rfqs: CustomerDashboardRfq[];
  rfqCount: number;
  readyOffers: CustomerDashboardRfq[];
  activeOrderCount: number;
  shippingOrderCount: number;
  openSupportCount: number;
  profileReadiness: {
    hasEmail: boolean;
    hasDefaultAddress: boolean;
    hasDefaultVehicle: boolean;
  };
  paymentExperience: CustomerPaymentExperience;
  disputeStatus?: string;
}

export const CUSTOMER_ACCOUNT_DATE = new Intl.DateTimeFormat('ar-SA', {
  dateStyle: 'medium',
  timeZone: 'Asia/Riyadh',
});

export function formatCustomerMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('ar-SA', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function customerStatusTone(
  status: string,
): 'brand' | 'success' | 'warning' | 'danger' {
  if (
    [
      'CANCELLED',
      'REFUNDED',
      'DISPUTED',
      'FAILED',
      'FAILED_FINAL',
      'LOST',
    ].includes(status)
  )
    return 'danger';
  if (
    [
      'AWAITING_CUSTOMER_CONFIRMATION',
      'AWAITING_PAYMENT',
      'NEED_MORE_INFO',
      'PENDING',
      'REQUESTED',
      'PROCESSING',
      'PROVIDER_PENDING',
      'UNDER_REVIEW',
    ].includes(status)
  )
    return 'warning';
  if (
    READY_ORDER_STATUSES.has(status) ||
    [
      'QUOTES_READY',
      'COMPLETED',
      'CAPTURED',
      'HELD',
      'RELEASED',
      'CLEAR',
    ].includes(status)
  )
    return 'success';
  return 'brand';
}

export function customerPaymentLabel(
  order: CustomerDashboardOrder,
  paymentExperience: CustomerPaymentExperience,
): string {
  if (order.payment && order.payment.provider !== 'MOCK')
    return PAYMENT_STATUS_AR[order.payment.status] ?? 'حالة دفع مسجّلة';
  if (order.status === 'AWAITING_PAYMENT') {
    return paymentExperience.paymentLabel;
  }
  if (order.status === 'REFUNDED') return 'تم الاسترداد';
  if (
    [
      'PAID',
      'ESCROW_HELD',
      'AWAITING_SUPPLIER_CONFIRMATION',
      'SUPPLIER_ACCEPTED',
      'FITMENT_VERIFIED',
      'READY_TO_SHIP',
      'SHIPPED',
      'IN_TRANSIT',
      'CUSTOMS_REVIEW',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'COMPLAINT_WINDOW',
      'CLOSED',
      'PAYOUT_RELEASED',
    ].includes(order.status)
  )
    return 'تم تسجيل الدفع';
  return 'لا توجد دفعة مسجّلة';
}

export function customerShipmentLabel(order: CustomerDashboardOrder): string {
  if (order.shipment && order.shipment.provider !== 'MOCK')
    return SHIPMENT_STATUS_AR[order.shipment.status] ?? 'حالة شحن مسجّلة';
  if (SHIPPING_ORDER_STATUSES.has(order.status) || order.status === 'DELIVERED')
    return ORDER_STATUS_AR[order.status] ?? 'الشحنة تحت المتابعة';
  return 'لم يبدأ الشحن';
}

export function customerFirstName(name: string): string {
  return name.trim().split(/\s+/u)[0] || 'عميل رفرف';
}
