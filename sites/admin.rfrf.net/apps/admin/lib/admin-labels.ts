/**
 * التسميات العربية لكل قيمة تعدادية تظهر للمشغّل.
 *
 * كانت الخرائط موزّعة على الصفحات وناقصة: خريطة حالات الطلب في لوحة القيادة
 * تغطّي تسع حالات من عشرين، فتسقط البقية إلى الاسم الخام. والحالتان الأكثر
 * شيوعاً في سوق حيّ — `AWAITING_SUPPLIER_CONFIRMATION` و`SUPPLIER_ACCEPTED` —
 * كانتا من الناقص، فظهرتا بالإنجليزية في جدول «أوامر الشراء الأخيرة».
 *
 * الصياغة هنا تخاطب المشغّل لا المورد: `AWAITING_SUPPLIER_CONFIRMATION` هي
 * «بانتظار قبول المورد» للمشغّل و«بانتظار قرارك» للمورد، فلكل سطح خريطته.
 * ما يحمي من التكرار هو اختبار التغطية في `tests/product-os`: يفشل حين تُضاف
 * حالة إلى التعداد بلا تسمية في أيّ من الخريطتين.
 */

export const ORDER_STATUS_AR: Record<string, string> = {
  CREATED: 'أُنشئ',
  AWAITING_CUSTOMER_CONFIRMATION: 'بانتظار تأكيد العميل',
  AWAITING_PAYMENT: 'بانتظار الدفع',
  PAID: 'مدفوع',
  ESCROW_HELD: 'مبلغ محتجز',
  AWAITING_SUPPLIER_CONFIRMATION: 'بانتظار قبول المورد',
  SUPPLIER_ACCEPTED: 'قبله المورد',
  FITMENT_VERIFIED: 'المطابقة معتمدة',
  READY_TO_SHIP: 'جاهز للشحن',
  SHIPPED: 'تم الشحن',
  IN_TRANSIT: 'في الطريق',
  CUSTOMS_REVIEW: 'مراجعة جمركية',
  OUT_FOR_DELIVERY: 'خارج للتسليم',
  DELIVERED: 'تم التسليم',
  COMPLAINT_WINDOW: 'نافذة الاعتراض',
  CLOSED: 'مغلق',
  PAYOUT_RELEASED: 'حُرِّرت المستحقات',
  CANCELLED: 'ملغى',
  REFUNDED: 'مسترد',
  DISPUTED: 'نزاع مفتوح',
};

/** حالات الصرف كما يراها المشغّل: مرحلة المعالجة تهمّه، بخلاف المورد. */
export const PAYOUT_STATUS_AR: Record<string, string> = {
  PENDING: 'بانتظار الجدولة',
  SCHEDULED: 'مجدول',
  APPROVED: 'معتمد للتحويل',
  SUBMITTING: 'جارٍ الإرسال للبنك',
  SUBMITTED: 'أُرسل للبنك',
  PAID: 'مدفوع',
  FAILED_RETRYABLE: 'فشل — قابل لإعادة المحاولة',
  FAILED_FINAL: 'فشل نهائي',
  ON_HOLD: 'موقوف',
  CANCELLED: 'ملغى',
};

export const DOCUMENT_TYPE_AR: Record<string, string> = {
  BUSINESS_REGISTRATION: 'السجل أو الرخصة التجارية',
  COMMERCIAL_REGISTRATION: 'السجل أو الرخصة التجارية',
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

export const PAYMENT_REFUND_STATUS_AR: Record<string, string> = {
  REQUESTED: 'مطلوب',
  PROCESSING: 'قيد التنفيذ',
  PROVIDER_PENDING: 'بانتظار المزوّد',
  COMPLETED: 'تم الاسترداد',
  // الفشل حالتان لا واحدة: القابل للإعادة يُعاد تلقائياً، والنهائي يحتاج يداً.
  FAILED_RETRYABLE: 'فشل — يُعاد تلقائياً',
  FAILED_FINAL: 'فشل نهائي — يحتاج تدخّلاً',
};

export const PAYMENT_STATUS_AR: Record<string, string> = {
  PENDING: 'معلّقة',
  AUTHORIZED: 'مُصرَّح بها',
  CAPTURED: 'محصّلة',
  HELD: 'محتجزة',
  RELEASED: 'محرَّرة',
  REFUNDED: 'مستردة',
  FAILED: 'فاشلة',
  CANCELLED: 'ملغاة',
};

export const SUPPLIER_STATUS_AR: Record<string, string> = {
  PENDING: 'بانتظار المراجعة',
  UNDER_REVIEW: 'تحت المراجعة',
  APPROVED: 'معتمد',
  LIMITED: 'معتمد بقيود',
  SUSPENDED: 'موقوف',
  REJECTED: 'مرفوض',
};

export const DISPUTE_STATUS_AR: Record<string, string> = {
  OPEN: 'مفتوح',
  UNDER_REVIEW: 'تحت المراجعة',
  RESOLVED_REFUND: 'حُسم باسترداد',
  RESOLVED_REJECTED: 'حُسم بالرفض',
  CLOSED: 'مغلق',
};

export const QUOTE_STATUS_AR: Record<string, string> = {
  DRAFT: 'مسودة',
  ACTIVE: 'نشط',
  APPROVED: 'معتمد',
  SELECTED: 'اختاره العميل',
  EXPIRED: 'منتهٍ',
  REJECTED: 'مرفوض',
};

export const RFQ_STATUS_AR: Record<string, string> = {
  DRAFT: 'مسودة',
  NEED_MORE_INFO: 'ينقصه بيان',
  FITMENT_REVIEW: 'مراجعة مطابقة',
  SOURCING_LOCAL: 'بحث محلي',
  SOURCING_GLOBAL: 'بحث دولي',
  QUOTES_READY: 'عروض جاهزة',
  CUSTOMER_SELECTED: 'اختار العميل',
  CONVERTED_TO_ORDER: 'تحوّل إلى طلب',
  CANCELLED: 'ملغى',
};

/**
 * مستوى مخاطر العرض كما يقرؤه المشغّل.
 *
 * كان يظهر خاماً في طابور الاستثناءات — وهو أكثر ما يحتاج وضوحاً، إذ يقرّر
 * المشغّل عليه قبول عرض أو حجبه عن العميل.
 */
export const RISK_LEVEL_AR: Record<string, string> = {
  LOW: 'منخفض',
  MEDIUM: 'متوسط',
  HIGH: 'مرتفع',
  BLOCKED: 'محظور',
};

/**
 * أسباب النزاع. ليست تعداداً في المخطط بل نصّ حرّ، وقد يحمل بادئة
 * `SUPPLIER_REJECTED:` — ولذلك دالّة مستقلّة تقشر البادئة قبل البحث.
 *
 * كانت هذه الخريطة محبوسة داخل صفحة القائمة، فظهر السبب خاماً في صفحة
 * التفاصيل المجاورة: نسخة واحدة في ملف واحد لا تخدم الصفحة الثانية.
 */
export const DISPUTE_REASON_AR: Record<string, string> = {
  WRONG_PART: 'القطعة غير مطابقة',
  DAMAGED: 'القطعة متضررة',
  NOT_AS_DESCRIBED: 'لا تطابق الوصف',
  MISSING_ITEMS: 'الشحنة ناقصة',
  OUT_OF_STOCK: 'رفض المورد: نفاد المخزون',
  PRICE_CHANGED: 'رفض المورد: تغير السعر',
  FITMENT_CONCERN: 'رفض المورد: التوافق',
  SLA_UNAVAILABLE: 'رفض المورد: مدة التوريد',
  OTHER: 'سبب آخر',
};

export function disputeReasonLabel(value: string): string {
  const code = value.includes(':') ? value.split(':').at(-1) : value;
  return DISPUTE_REASON_AR[code ?? ''] ?? value;
}

/**
 * تُرجع التسمية العربية، وتردّ القيمة الخام حين لا تُعرف.
 *
 * الردّ بالقيمة الخام مقصود: حالة جديدة غير مترجمة تظهر كاسمها فيُلاحَظ النقص،
 * بينما إخفاؤها أو استبدالها بشرطة يخفي بيانات حقيقية عن المشغّل.
 */
export function ar(
  map: Record<string, string>,
  value: string | null | undefined,
  fallback?: string,
): string {
  if (value == null || value === '') return fallback ?? '—';
  return map[value] ?? fallback ?? value;
}
