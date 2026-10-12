/**
 * التسميات العربية لكل قيمة تعدادية تظهر للمورد.
 *
 * كانت كل صفحة تحمل خريطتها الخاصة، فاختلفت الصياغة للحالة نفسها بين اللوحة
 * وطابور التنفيذ، وسقطت مواضع كاملة إلى القيمة الخام: لوحة المورد كانت تعرض
 * `SUPPLIER_ACCEPTED` بينما تعرض `/orders` الطلب نفسه «قيد التجهيز». توحيدها
 * هنا يجعل النسيان مستحيلاً: من يعرض حالة يستورد `ar()` ولا يكتب خريطة جديدة.
 *
 * القيم الخام إنجليزية لأنها أسماء تعدادات القاعدة؛ لا تظهر للمورد أبداً إلا
 * كملاذ أخير حين تُضاف حالة جديدة ولم تُترجَم بعد — وهذا أوضح من إخفائها.
 */

export const ORDER_STATUS_AR: Record<string, string> = {
  CREATED: 'جديد',
  AWAITING_CUSTOMER_CONFIRMATION: 'بانتظار العميل',
  AWAITING_PAYMENT: 'بانتظار الدفع',
  PAID: 'مدفوع',
  ESCROW_HELD: 'المبلغ محجوز',
  AWAITING_SUPPLIER_CONFIRMATION: 'بانتظار قرارك',
  SUPPLIER_ACCEPTED: 'قيد التجهيز',
  FITMENT_VERIFIED: 'التوافق معتمد',
  READY_TO_SHIP: 'جاهز للشحن',
  SHIPPED: 'تم الشحن',
  IN_TRANSIT: 'في الطريق',
  CUSTOMS_REVIEW: 'مراجعة جمركية',
  OUT_FOR_DELIVERY: 'خارج للتسليم',
  DELIVERED: 'تم التسليم',
  COMPLAINT_WINDOW: 'نافذة الاعتراض',
  CLOSED: 'مغلق',
  PAYOUT_RELEASED: 'تم تحرير المستحقات',
  CANCELLED: 'ملغى',
  REFUNDED: 'مسترد',
  DISPUTED: 'تحت مراجعة العمليات',
};

export const SHIPMENT_STATUS_AR: Record<string, string> = {
  PENDING: 'لم تُنشأ بعد',
  LABEL_CREATED: 'أُنشئ الملصق',
  PICKED_UP: 'استلمها الناقل',
  IN_TRANSIT: 'في الطريق',
  CUSTOMS: 'لدى الجمارك',
  OUT_FOR_DELIVERY: 'خارجة للتسليم',
  DELIVERED: 'سُلّمت',
  RETURNED: 'مرتجعة',
  LOST: 'مفقودة',
};

export const QUOTE_STATUS_AR: Record<string, string> = {
  DRAFT: 'مسودة',
  ACTIVE: 'قيد المراجعة',
  APPROVED: 'معتمد',
  SELECTED: 'اختاره العميل',
  EXPIRED: 'منتهي',
  REJECTED: 'مرفوض',
};

export const RFQ_STATUS_AR: Record<string, string> = {
  SOURCING_LOCAL: 'بحث محلي',
  SOURCING_GLOBAL: 'بحث دولي',
};

/** حالات الصرف كما يراها المورد: ما يهمّه وصول المال، لا مرحلة المعالجة. */
export const PAYOUT_STATUS_AR: Record<string, string> = {
  PENDING: 'بانتظار الجدولة',
  SCHEDULED: 'مجدول',
  APPROVED: 'معتمد للتحويل',
  SUBMITTING: 'جارٍ التحويل',
  SUBMITTED: 'أُرسل للبنك',
  PAID: 'وصل',
  FAILED_RETRYABLE: 'تعذّر — تُعاد المحاولة',
  FAILED_FINAL: 'تعذّر نهائياً',
  ON_HOLD: 'موقوف',
  CANCELLED: 'ملغى',
};

export const DOCUMENT_TYPE_AR: Record<string, string> = {
  BUSINESS_REGISTRATION: 'السجل أو الرخصة التجارية',
  COMMERCIAL_REGISTRATION: 'السجل أو الرخصة التجارية',
  FREELANCE_CERTIFICATE: 'وثيقة العمل الحر',
  FREELANCE_WORK_CERTIFICATE: 'وثيقة العمل الحر',
  VAT_CERTIFICATE: 'شهادة ضريبة القيمة المضافة',
  BANK_LETTER: 'خطاب بنكي',
};

export const DOCUMENT_STATUS_AR: Record<string, string> = {
  PENDING: 'بانتظار المراجعة',
  APPROVED: 'معتمدة',
  REJECTED: 'مرفوضة',
  EXPIRED: 'منتهية',
};

export const SUPPLIER_STATUS_AR: Record<string, string> = {
  PENDING: 'بانتظار المراجعة',
  UNDER_REVIEW: 'تحت المراجعة',
  APPROVED: 'معتمد',
  LIMITED: 'معتمد بقيود',
  SUSPENDED: 'موقوف',
  REJECTED: 'مرفوض',
};

/**
 * تُرجع التسمية العربية، وتردّ القيمة الخام حين لا تُعرف.
 *
 * الردّ بالقيمة الخام مقصود: حالة جديدة غير مترجمة تظهر كاسمها فيُلاحَظ النقص،
 * بينما إخفاؤها أو استبدالها بشرطة يخفي بيانات حقيقية عن المورد.
 */
export function ar(
  map: Record<string, string>,
  value: string | null | undefined,
  fallback?: string,
): string {
  if (value == null || value === '') return fallback ?? '—';
  return map[value] ?? fallback ?? value;
}
