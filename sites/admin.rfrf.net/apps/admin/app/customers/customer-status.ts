export const CUSTOMER_RFQ_STATUS_AR: Record<string, string> = {
  DRAFT: 'مسودة',
  NEED_MORE_INFO: 'بحاجة إلى معلومات',
  FITMENT_REVIEW: 'مراجعة المطابقة',
  SOURCING_LOCAL: 'بحث محلي',
  SOURCING_GLOBAL: 'بحث عالمي',
  QUOTES_READY: 'العروض جاهزة',
  CUSTOMER_SELECTED: 'اختار العميل',
  CONVERTED_TO_ORDER: 'تحوّل إلى طلب',
  CANCELLED: 'ملغي',
};

export const CUSTOMER_ORDER_STATUS_AR: Record<string, string> = {
  CREATED: 'تم إنشاء الطلب',
  AWAITING_CUSTOMER_CONFIRMATION: 'بانتظار تأكيد العميل',
  AWAITING_PAYMENT: 'بانتظار الدفع',
  PAID: 'مدفوع',
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

export function formatCustomerMoney(amount: unknown, currency: string): string {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) return 'قيمة غير صالحة';

  try {
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(numericAmount);
  } catch {
    return numericAmount.toFixed(2) + ' ' + currency;
  }
}
