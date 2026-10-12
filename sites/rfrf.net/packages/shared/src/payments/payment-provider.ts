import type { ProviderOutcome } from './payment-state';

/**
 * عقد محايد لمزوّد الدفع: authorize / capture / refund / webhook.
 *
 * الغرض أن يبقى منطق الطلب والضمان جاهلاً بالمزوّد تماماً، فيصير استبدال
 * المزوّد أو تشغيل محاكاة في الاختبارات تبديلَ تنفيذ واحد لا إعادة كتابة.
 *
 * ملاحظة تخصّ رفرف: لا يظهر في هذه الواجهة أي حقل بطاقة. المنصة تستخدم
 * Checkout المستضاف، فبيانات البطاقة لا تمرّ عبر خوادمنا ولا عبر هذا العقد.
 */

export interface PaymentMoney {
  /** نص عشري بمنزلتين — يُحفظ ويُوقَّع كنص لتفادي أخطاء الفاصلة العائمة. */
  amount: string;
  currency: string;
}

export interface PaymentPayer {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  address: string;
  zip: string;
  /** عنوان الدافع كما رآه الخادم؛ يطلبه بعض المزوّدين لتقييم المخاطر. */
  ip: string;
}

export interface AuthorizeRequest {
  /**
   * **كود** الطلب المرئي (`Order.code`) لا معرّفه الداخلي.
   *
   * هذا هو المفتاح الذي يعيده المزوّد في إشعاره، ومستقبِل الإشعار يبحث به عن
   * الدفعة. تمرير `Order.id` هنا يجعل كل إشعار وارد بلا مطابقة، فتُستهلك
   * الإشعارات بصمت ولا تتقدّم أي دفعة أبداً.
   */
  orderCode: string;
  money: PaymentMoney;
  description: string;
  payer: PaymentPayer;
  /** يعود إليه العميل بعد إتمام أو فشل الدفع لدى المزوّد. */
  returnUrl: string;
  /** يستقبل إشعار المزوّد الخادمي بالنتيجة النهائية. */
  notificationUrl: string;
}

export interface AuthorizeResult {
  /** يوجَّه إليه العميل لإتمام الدفع على صفحة المزوّد المستضافة. */
  redirectUrl: string;
  /** مرجع المعاملة لدى المزوّد، إن أعاده فوراً. */
  externalRef: string | null;
}

export interface CaptureRequest {
  /** كود الطلب المرئي، كما في `AuthorizeRequest`. */
  orderCode: string;
  externalRef: string;
  money: PaymentMoney;
}

export interface RefundRequest {
  /** كود الطلب المرئي، كما في `AuthorizeRequest`. */
  orderCode: string;
  externalRef: string;
  /** استرداد جزئي عند تمريره، وكامل عند إغفاله. */
  money?: PaymentMoney;
}

export interface PaymentOperationResult {
  outcome: ProviderOutcome;
  externalRef: string | null;
  /** سبب المزوّد عند الرفض — للتشخيص والتدقيق، لا لعرضه على العميل حرفياً. */
  declineReason: string | null;
  /** Authenticated provider state that must block payout for manual resolution. */
  reconciliationIssue?: 'PROVIDER_PARTIAL_REFUND';
  /** Explicit refund history proven by the authenticated status response. */
  refundEligibility?: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'UNKNOWN';
}

/**
 * نتيجة تحليل إشعار وارد. `verified` منفصلة عن بقية الحقول عمداً: الاستدعاء
 * يجب أن يفحصها قبل النظر في أي حقل آخر، فحمولة غير موثَّقة لا تعني شيئاً.
 */
export interface WebhookParseResult {
  verified: boolean;
  /** كود الطلب كما أعاده المزوّد — يُبحث به عن الدفعة. */
  orderCode: string | null;
  externalRef: string | null;
  outcome: ProviderOutcome | null;
  /** Signed wake-up classification only; provider status remains authoritative. */
  operation?: 'REFUND' | null;
  declineReason: string | null;
}

export interface PaymentProvider {
  readonly name: string;
  authorize(request: AuthorizeRequest): Promise<AuthorizeResult>;
  capture(request: CaptureRequest): Promise<PaymentOperationResult>;
  refund(request: RefundRequest): Promise<PaymentOperationResult>;
  /**
   * يستخرج الإشارة الواردة وقد يتحقق منها إن نشر المزوّد عقد التوقيع. لا
   * يلمس قاعدة البيانات ولا يقرر انتقال حالة؛ المزوّدات غير المتحققة يجب أن
   * تُؤكَّد باستعلام خادمي موثّق قبل `decideWebhookApplication`.
   */
  parseWebhook(payload: unknown, rawBody?: string): WebhookParseResult;
}

const PAYMENT_PROVIDER_ERROR_BRAND = Symbol.for(
  '@rafraf/shared/payment-provider-error',
);

export class PaymentProviderError extends Error {
  readonly provider: string;
  readonly retryable: boolean;

  constructor(provider: string, message: string, retryable = false) {
    super(message);
    this.name = 'PaymentProviderError';
    this.provider = provider;
    this.retryable = retryable;
    Object.defineProperty(this, PAYMENT_PROVIDER_ERROR_BRAND, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
}

/**
 * Recognize provider errors even when a bundle loads this module twice.
 *
 * `instanceof` alone is unsafe for operational classification because two
 * copies have different constructors. The global symbol survives that split;
 * the field checks keep arbitrary errors fail-closed.
 */
export function isPaymentProviderError(
  error: unknown,
): error is PaymentProviderError {
  if (
    (typeof error !== 'object' || error === null) &&
    typeof error !== 'function'
  ) {
    return false;
  }
  try {
    const candidate = error as Record<PropertyKey, unknown>;
    const branded = candidate[PAYMENT_PROVIDER_ERROR_BRAND] === true;
    return (
      (branded || error instanceof PaymentProviderError) &&
      candidate.name === 'PaymentProviderError' &&
      typeof candidate.provider === 'string' &&
      candidate.provider.length > 0 &&
      typeof candidate.retryable === 'boolean'
    );
  } catch {
    return false;
  }
}
