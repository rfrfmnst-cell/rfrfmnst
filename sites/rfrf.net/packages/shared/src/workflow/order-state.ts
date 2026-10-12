/**
 * آلة حالة الطلب — خريطة انتقالات صريحة فوق `OrderStatus` في schema.prisma،
 * كما تفرضه قواعد الاختبار في CLAUDE.md.
 *
 * الحالات ليست مخترعة هنا: هي تعداد قاعدة البيانات حرفياً. الخريطة تصف
 * المسار المقصود كاملاً، بينما المنفَّذ اليوم جزء منه فقط (إنشاء الطلب،
 * ثم احتجاز الضمان عند تأكيد الدفع). اختبار العقد يضمن أن كل انتقال ينفّذه
 * الكود فعلاً مسموح هنا، فلا تنحرف الخريطة عن الواقع بمرور الوقت.
 */
export type OrderState =
  | 'CREATED'
  | 'AWAITING_CUSTOMER_CONFIRMATION'
  | 'AWAITING_PAYMENT'
  | 'PAID'
  | 'ESCROW_HELD'
  | 'AWAITING_SUPPLIER_CONFIRMATION'
  | 'SUPPLIER_ACCEPTED'
  | 'FITMENT_VERIFIED'
  | 'READY_TO_SHIP'
  | 'SHIPPED'
  | 'IN_TRANSIT'
  | 'CUSTOMS_REVIEW'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'COMPLAINT_WINDOW'
  | 'CLOSED'
  | 'PAYOUT_RELEASED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'DISPUTED';

/**
 * الإلغاء متاح ما دام المال لم يُحتجز؛ بعده يصير المخرج ردّاً لا إلغاءً،
 * لأن هناك مبلغاً محتجزاً يجب أن يُعاد لا أن يُنسى.
 */
const CANCELLABLE_EXITS: readonly OrderState[] = ['CANCELLED'];
const REFUNDABLE_EXITS: readonly OrderState[] = ['REFUNDED', 'DISPUTED'];

export const ORDER_TRANSITIONS: Readonly<
  Record<OrderState, readonly OrderState[]>
> = Object.freeze({
  CREATED: [
    'AWAITING_CUSTOMER_CONFIRMATION',
    'AWAITING_PAYMENT',
    ...CANCELLABLE_EXITS,
  ],
  AWAITING_CUSTOMER_CONFIRMATION: ['AWAITING_PAYMENT', ...CANCELLABLE_EXITS],
  // الاحتجاز المباشر هو ما ينفّذه الكود اليوم: تأكيد الدفع يكتب قيد HOLD
  // وينقل الطلب في المعاملة نفسها، فلا يمرّ بـ PAID كحالة قائمة بذاتها.
  // `PAID` مسار قائم في الخريطة ولا ينتجه كود اليوم: تأكيد الدفع يحتجز
  // مباشرةً. يبقى للمزوّدين الذين يفصلون التحصيل عن الاحتجاز.
  AWAITING_PAYMENT: ['PAID', 'ESCROW_HELD', ...CANCELLABLE_EXITS],
  PAID: ['ESCROW_HELD', ...REFUNDABLE_EXITS],
  ESCROW_HELD: ['AWAITING_SUPPLIER_CONFIRMATION', ...REFUNDABLE_EXITS],
  AWAITING_SUPPLIER_CONFIRMATION: ['SUPPLIER_ACCEPTED', ...REFUNDABLE_EXITS],
  SUPPLIER_ACCEPTED: ['FITMENT_VERIFIED', ...REFUNDABLE_EXITS],
  FITMENT_VERIFIED: ['READY_TO_SHIP', ...REFUNDABLE_EXITS],
  READY_TO_SHIP: ['SHIPPED', ...REFUNDABLE_EXITS],
  SHIPPED: ['IN_TRANSIT', ...REFUNDABLE_EXITS],
  // مراجعة الجمارك تخصّ المصدر المستورد وحده، فهي فرع لا محطة إلزامية.
  IN_TRANSIT: ['CUSTOMS_REVIEW', 'OUT_FOR_DELIVERY', ...REFUNDABLE_EXITS],
  CUSTOMS_REVIEW: ['OUT_FOR_DELIVERY', ...REFUNDABLE_EXITS],
  OUT_FOR_DELIVERY: ['DELIVERED', ...REFUNDABLE_EXITS],
  DELIVERED: ['COMPLAINT_WINDOW', ...REFUNDABLE_EXITS],
  COMPLAINT_WINDOW: ['CLOSED', 'DISPUTED'],
  // المال يُفرج عنه للمورد بعد إغلاق نافذة الشكوى، لا قبلها.
  CLOSED: ['PAYOUT_RELEASED'],
  // النزاع له مخرجان فقط، وكلاهما يسوّي المال صراحةً: ردّ للعميل، أو إغلاق
  // لصالح المورد يقود إلى صرف مستحقّه. لا مخرج ثالث يترك مبلغاً محتجزاً بلا
  // قرار — وهذا ما يجعل الوصول إلى PAYOUT_RELEASED مقصوراً على CLOSED.
  DISPUTED: ['REFUNDED', 'CLOSED'],
  PAYOUT_RELEASED: [],
  CANCELLED: [],
  REFUNDED: [],
});

export const TERMINAL_ORDER_STATES: readonly OrderState[] = Object.freeze([
  'PAYOUT_RELEASED',
  'CANCELLED',
  'REFUNDED',
]);

export function isTerminalOrderState(state: OrderState): boolean {
  return ORDER_TRANSITIONS[state].length === 0;
}

export function canTransitionOrder(from: OrderState, to: OrderState): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/**
 * الحالات التي ما زال فيها مال محتجز — مشتقّة من الخريطة لا مكتوبة بجانبها.
 *
 * قائمة يدوية موازية كانت ستتخلّف عن أي حالة جديدة تُضاف إلى `OrderStatus`
 * لاحقاً، فيصير تعريفان للاحتجاز يختلفان بصمت. الاشتقاق: كل ما يُبلَغ من
 * `ESCROW_HELD` دون المرور بتسوية، مضافاً إليه `ESCROW_HELD` نفسها.
 * التسويات (`PAYOUT_RELEASED` صرفاً للمورد، و`REFUNDED` ردّاً للعميل، و`CLOSED`
 * إقراراً بانتهاء النزاع أو نافذة الشكوى) هي حدود الانتشار.
 */
const ESCROW_SETTLEMENTS: readonly OrderState[] = [
  'PAYOUT_RELEASED',
  'REFUNDED',
  'CLOSED',
];

const ESCROW_HOLDING_STATES: ReadonlySet<OrderState> = (() => {
  const holding = new Set<OrderState>(['ESCROW_HELD']);
  const queue: OrderState[] = ['ESCROW_HELD'];
  while (queue.length) {
    for (const next of ORDER_TRANSITIONS[queue.shift()!]) {
      if (ESCROW_SETTLEMENTS.includes(next) || holding.has(next)) continue;
      holding.add(next);
      queue.push(next);
    }
  }
  return holding;
})();

export function holdsEscrowMoney(state: OrderState): boolean {
  return ESCROW_HOLDING_STATES.has(state);
}

export class OrderTransitionError extends Error {
  readonly from: OrderState;
  readonly to: OrderState;

  constructor(from: OrderState, to: OrderState) {
    super(`order transition ${from} → ${to} is not allowed`);
    this.name = 'OrderTransitionError';
    this.from = from;
    this.to = to;
  }
}

/** يرمي بدل أن يعيد قيمة صامتة: انتقال طلب غير مسموح خطأ برمجي. */
export function assertOrderTransition(from: OrderState, to: OrderState): void {
  if (!canTransitionOrder(from, to)) {
    throw new OrderTransitionError(from, to);
  }
}
