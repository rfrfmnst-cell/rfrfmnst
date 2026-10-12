const CUSTOMER_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export function normalizeCustomerEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !CUSTOMER_EMAIL_PATTERN.test(email)) {
    return null;
  }
  return email;
}

/**
 * الاسم المؤقت الذي يُنشأ به العميل عند أول دخول.
 *
 * بقيت بعض الحسابات القديمة من مسار OTP الذي سبق اشتراط الاسم عند التسجيل،
 * بينما `Customer.fullName` إلزامي في المخطط. التسجيل الحالي يطلب الاسم، وهذه
 * القيمة موجودة فقط للتوافق مع السجلات القديمة وليست اسماً صالحاً لأي مخرَج
 * يراه طرف خارجي.
 *
 * تعريف واحد هنا لا سلسلة منسوخة في كل موضع: نسخة ثانية تتخلّف عند أي تعديل،
 * فيصير حارس يفحص نصاً وكاتب ينتج نصاً آخر.
 */
export const PLACEHOLDER_CUSTOMER_NAME = 'عميل رفرف';

/**
 * هل يحمل العميل اسماً حقيقياً يصلح للإرسال إلى طرف خارجي؟
 *
 * يُستخدم قبل الدفع والشحن والفوترة: بوابة الدفع تتلقى الاسم مقسوماً إلى أول
 * وأخير، والفاتورة الضريبية تحمل اسم المشتري. تمرير الاسم المؤقت هناك يُنشئ
 * سجلاً خارجياً باسم لا يخصّ أحداً.
 */
export function hasRealCustomerName(fullName: unknown): boolean {
  if (typeof fullName !== 'string') return false;
  const name = fullName.trim();
  if (name.length < 2 || name === PLACEHOLDER_CUSTOMER_NAME) return false;
  return true;
}
