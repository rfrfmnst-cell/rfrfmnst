import { OrderStatus, RFQStatus, ShipmentStatus } from '@rafraf/db';
import { isExternalCarrierShipment } from '@rafraf/shared/workflow/shipment-proof';

export function formatTrackingDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const RFQ_STATUS_AR: Record<RFQStatus, string> = {
  DRAFT: 'استلمنا طلبك — قيد المراجعة',
  NEED_MORE_INFO: 'نحتاج معلومات إضافية منك',
  FITMENT_REVIEW: 'جارٍ التحقق من توافق القطعة',
  SOURCING_LOCAL: 'نبحث لك عن أفضل العروض محلياً',
  SOURCING_GLOBAL: 'نبحث لك عن أفضل العروض عالمياً',
  QUOTES_READY: 'عروضك جاهزة — تحقق من جوالك',
  CUSTOMER_SELECTED: 'تم اختيار العرض',
  CONVERTED_TO_ORDER: 'تحوّل إلى أمر شراء',
  CANCELLED: 'ملغي',
};

export const ORDER_STATUS_AR: Record<OrderStatus, string> = {
  CREATED: 'أُنشئ أمر الشراء',
  AWAITING_CUSTOMER_CONFIRMATION: 'بانتظار تأكيدك',
  AWAITING_PAYMENT: 'بانتظار الدفع',
  PAID: 'تم استلام الدفع',
  ESCROW_HELD: 'مدفوع — مبلغك محفوظ بأمان حتى التسليم',
  AWAITING_SUPPLIER_CONFIRMATION: 'جارٍ تأكيد توفر القطعة',
  SUPPLIER_ACCEPTED: 'تم تأكيد توفر القطعة',
  FITMENT_VERIFIED: 'تم التحقق من التوافق',
  READY_TO_SHIP: 'جاهز للشحن',
  SHIPPED: 'تم الشحن',
  IN_TRANSIT: 'في الطريق إليك',
  CUSTOMS_REVIEW: 'في التخليص الجمركي',
  OUT_FOR_DELIVERY: 'خرج للتوصيل',
  DELIVERED: 'تم التسليم',
  COMPLAINT_WINDOW: 'تم التسليم — نافذة التأكد مفتوحة',
  CLOSED: 'مكتمل',
  PAYOUT_RELEASED: 'مكتمل',
  CANCELLED: 'ملغي',
  REFUNDED: 'تم الاسترداد',
  DISPUTED: 'قيد معالجة شكوى',
};

const SHIPMENT_STATUS_AR: Record<ShipmentStatus, string> = {
  PENDING: 'بانتظار تجهيز الناقل',
  LABEL_CREATED: 'صدرت بوليصة الشحن',
  PICKED_UP: 'استلم الناقل الشحنة',
  IN_TRANSIT: 'في الطريق إليك',
  CUSTOMS: 'في التخليص الجمركي',
  OUT_FOR_DELIVERY: 'خرجت للتوصيل',
  DELIVERED: 'تم تسليم الشحنة',
  RETURNED: 'أُعيدت الشحنة',
  LOST: 'الشحنة مفقودة — يتابعها فريق الدعم',
};

export function shipmentTimelineEntry(shipment: {
  provider: string;
  trackingNumber: string | null;
  status: ShipmentStatus;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  lastProviderEventAt: Date | null;
  updatedAt: Date;
}): { label: string; date: string } | null {
  if (!isExternalCarrierShipment(shipment)) return null;
  const occurredAt =
    (shipment.status === ShipmentStatus.DELIVERED
      ? shipment.deliveredAt
      : null) ??
    (shipment.status === ShipmentStatus.PICKED_UP
      ? shipment.shippedAt
      : null) ??
    shipment.lastProviderEventAt ??
    shipment.updatedAt;
  return {
    label: `الشحنة: ${SHIPMENT_STATUS_AR[shipment.status]}`,
    date: formatTrackingDateTime(occurredAt),
  };
}
