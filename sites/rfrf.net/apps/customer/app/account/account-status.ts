export const ORDER_STATUS_AR: Record<string, string> = {
  CREATED: 'تم إنشاء الطلب',
  AWAITING_CUSTOMER_CONFIRMATION: 'بانتظار تأكيدك',
  AWAITING_PAYMENT: 'بانتظار الدفع',
  PAID: 'تم الدفع',
  ESCROW_HELD: 'المبلغ محفوظ',
  AWAITING_SUPPLIER_CONFIRMATION: 'بانتظار المورد',
  SUPPLIER_ACCEPTED: 'قبله المورد',
  FITMENT_VERIFIED: 'تم التحقق من المطابقة',
  READY_TO_SHIP: 'جاهز للشحن',
  SHIPPED: 'تم الشحن',
  IN_TRANSIT: 'في الطريق',
  CUSTOMS_REVIEW: 'مراجعة جمركية',
  OUT_FOR_DELIVERY: 'خرج للتسليم',
  DELIVERED: 'تم التسليم',
  COMPLAINT_WINDOW: 'نافذة الضمان',
  CLOSED: 'مكتمل',
  PAYOUT_RELEASED: 'أُغلقت التسوية',
  CANCELLED: 'ملغي',
  REFUNDED: 'مسترد',
  DISPUTED: 'نزاع مفتوح',
};

export const READY_ORDER_STATUSES = new Set([
  'PAID',
  'ESCROW_HELD',
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
]);

export const RFQ_STATUS_AR: Record<string, string> = {
  DRAFT: 'مسودة',
  NEED_MORE_INFO: 'بحاجة إلى معلومات',
  FITMENT_REVIEW: 'مراجعة المطابقة',
  SOURCING_LOCAL: 'جاري البحث المحلي',
  SOURCING_GLOBAL: 'جاري البحث العالمي',
  QUOTES_READY: 'يوجد عروض',
  CUSTOMER_SELECTED: 'تم اختيار العرض',
  CONVERTED_TO_ORDER: 'تحوّل إلى طلب',
  CANCELLED: 'ملغي',
};

export const RFQ_STATUSES_WITH_VISIBLE_OFFERS = new Set([
  'QUOTES_READY',
  'CUSTOMER_SELECTED',
]);

export const ACTIVE_ORDER_STATUSES = new Set([
  'CREATED',
  'AWAITING_CUSTOMER_CONFIRMATION',
  'AWAITING_PAYMENT',
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
  'DISPUTED',
]);

export const SHIPPING_ORDER_STATUSES = new Set([
  'READY_TO_SHIP',
  'SHIPPED',
  'IN_TRANSIT',
  'CUSTOMS_REVIEW',
  'OUT_FOR_DELIVERY',
]);

export const PAYMENT_STATUS_AR: Record<string, string> = {
  PENDING: 'الدفع قيد المعالجة',
  AUTHORIZED: 'تم تفويض الدفع',
  CAPTURED: 'تم استلام الدفع',
  HELD: 'المبلغ محفوظ بأمان',
  RELEASED: 'اكتملت التسوية',
  REFUNDED: 'تم استرداد الدفعة',
  FAILED: 'تعذّر الدفع',
  CANCELLED: 'أُلغي الدفع',
};

export const SHIPMENT_STATUS_AR: Record<string, string> = {
  PENDING: 'قيد تجهيز الشحنة',
  LABEL_CREATED: 'أُنشئت بوليصة الشحن',
  PICKED_UP: 'استلم الناقل الشحنة',
  IN_TRANSIT: 'الشحنة في الطريق',
  CUSTOMS: 'في التخليص الجمركي',
  OUT_FOR_DELIVERY: 'خرجت للتسليم',
  DELIVERED: 'تم تسليم الشحنة',
  RETURNED: 'أُعيدت الشحنة',
  LOST: 'تحتاج الشحنة إلى متابعة',
};

export const REFUND_STATUS_AR: Record<string, string> = {
  REQUESTED: 'طُلب الاسترداد',
  PROCESSING: 'جارٍ معالجة الاسترداد',
  PROVIDER_PENDING: 'بانتظار تأكيد الاسترداد',
  COMPLETED: 'اكتمل الاسترداد',
  FAILED_RETRYABLE: 'الاسترداد يحتاج إعادة محاولة',
  FAILED_FINAL: 'تعذّر الاسترداد',
};

export const DISPUTE_STATUS_AR: Record<string, string> = {
  OPEN: 'شكوى مفتوحة',
  UNDER_REVIEW: 'الشكوى قيد المراجعة',
  RESOLVED_REFUND: 'حُلّت الشكوى باسترداد',
  RESOLVED_REJECTED: 'أُغلقت الشكوى بعد المراجعة',
  CLOSED: 'الشكوى مغلقة',
};
