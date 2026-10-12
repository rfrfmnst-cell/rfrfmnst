/**
 * آلة حالة الدفع — خريطة انتقالات صريحة فوق `PaymentStatus` في schema.prisma.
 *
 * الحالات ليست مخترعة هنا: هي نفس تعداد قاعدة البيانات حرفياً. المسار يعكس
 * نموذج الضمان في المنصة — يُلتقط المبلغ، ثم يُحتجز حتى تكتمل شروط الطلب،
 * ثم يُفرج عنه للمورد أو يُردّ للعميل.
 */
export type PaymentState =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'HELD'
  | 'RELEASED'
  | 'REFUNDED'
  | 'FAILED'
  | 'CANCELLED';

export const PAYMENT_TRANSITIONS: Readonly<
  Record<PaymentState, readonly PaymentState[]>
> = Object.freeze({
  // بانتظار نتيجة المزوّد: قد يُصرَّح به، أو يُلتقط مباشرة في مسار SALE، أو يفشل.
  PENDING: ['AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED'],
  // تصريح بلا التقاط: يُلتقط لاحقاً أو يُلغى قبل انقضائه.
  AUTHORIZED: ['CAPTURED', 'CANCELLED', 'FAILED'],
  // مبلغ محصَّل: يدخل الضمان أو يُردّ كاملاً.
  CAPTURED: ['HELD', 'REFUNDED'],
  // محتجز في الضمان بانتظار اكتمال الطلب.
  HELD: ['RELEASED', 'REFUNDED'],
  // حالات نهائية: لا انتقال بعدها.
  RELEASED: [],
  REFUNDED: [],
  FAILED: [],
  CANCELLED: [],
});

export const TERMINAL_PAYMENT_STATES: readonly PaymentState[] = Object.freeze([
  'RELEASED',
  'REFUNDED',
  'FAILED',
  'CANCELLED',
]);

export function isTerminalPaymentState(state: PaymentState): boolean {
  return PAYMENT_TRANSITIONS[state].length === 0;
}

export function canTransitionPayment(
  from: PaymentState,
  to: PaymentState,
): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

export class PaymentTransitionError extends Error {
  readonly from: PaymentState;
  readonly to: PaymentState;

  constructor(from: PaymentState, to: PaymentState) {
    super(`payment transition ${from} → ${to} is not allowed`);
    this.name = 'PaymentTransitionError';
    this.from = from;
    this.to = to;
  }
}

/** يرمي بدل أن يعيد قيمة صامتة: انتقال دفع غير مسموح خطأ برمجي، لا حالة متوقعة. */
export function assertPaymentTransition(
  from: PaymentState,
  to: PaymentState,
): void {
  if (!canTransitionPayment(from, to)) {
    throw new PaymentTransitionError(from, to);
  }
}

/**
 * حالة الدفع التي يقابلها كل نتيجة مزوّد. يبقى القرار هنا — في المنطق النقي —
 * حتى لا يخترع كل محوّل مزوّد تعييناً خاصاً به.
 */
export type ProviderOutcome =
  'AUTHORIZED' | 'CAPTURED' | 'DECLINED' | 'CANCELLED' | 'PENDING' | 'REFUNDED';

const OUTCOME_TO_STATE: Readonly<Record<ProviderOutcome, PaymentState>> =
  Object.freeze({
    AUTHORIZED: 'AUTHORIZED',
    CAPTURED: 'CAPTURED',
    DECLINED: 'FAILED',
    CANCELLED: 'CANCELLED',
    PENDING: 'PENDING',
    REFUNDED: 'REFUNDED',
  });

export function stateForProviderOutcome(
  outcome: ProviderOutcome,
): PaymentState {
  return OUTCOME_TO_STATE[outcome];
}

/**
 * الحالة الوحيدة التي يجوز فيها بدء دفعة أو تسجيلها.
 *
 * الطلب يُنشأ عند اعتماد العميل مباشرةً بـ `AWAITING_PAYMENT`، فلا يمرّ بأي
 * حالة أخرى قابلة للدفع. توسيع هذه القائمة يفتح الدفع على طلبات لم تُعتمد
 * بعد أو حُسمت بالفعل، ولذلك تعيش هنا لا في كل مسار على حدة.
 */
export const PAYABLE_ORDER_STATUS = 'AWAITING_PAYMENT';

/** الحالة التي ينتقل إليها الطلب فور احتجاز المال في الضمان. */
export const ORDER_STATUS_ON_ESCROW_HOLD = 'ESCROW_HELD';

export function isOrderPayable(status: string): boolean {
  return status === PAYABLE_ORDER_STATUS;
}

/**
 * هل تستوجب هذه النتيجة احتجازاً في دفتر الضمان؟
 *
 * `CAPTURED` وحدها: التصريح (`AUTHORIZED`) لا يعني وصول مال، واحتجاز ضمان
 * على مبلغ لم يُحصَّل يجعل الدفتر يخالف الواقع.
 */
export function requiresEscrowHold(outcome: ProviderOutcome): boolean {
  return stateForProviderOutcome(outcome) === 'CAPTURED';
}

/**
 * هل يجوز تطبيق نتيجة مزوّد واردة على الحالة الحالية؟
 *
 * إعادة تسليم نفس النتيجة (webhook يُعاد إرساله) ليست خطأً — تُعتبر لا-عملية.
 * أما نتيجة تتراجع بالحالة أو تصل بعد حالة نهائية فتُرفض.
 */
export type WebhookDecision = 'apply' | 'ignore' | 'reject';

export function decideWebhookApplication(
  current: PaymentState,
  outcome: ProviderOutcome,
): WebhookDecision {
  const next = stateForProviderOutcome(outcome);
  if (next === current) return 'ignore';
  if (isTerminalPaymentState(current)) return 'reject';
  return canTransitionPayment(current, next) ? 'apply' : 'reject';
}
