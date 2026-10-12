/**
 * آلة حالة طلب التسعير — خريطة انتقالات صريحة فوق `RFQStatus` في schema.prisma،
 * كما تفرضه قواعد الاختبار في CLAUDE.md (تسع حالات).
 *
 * الحالات ليست مخترعة هنا: هي تعداد قاعدة البيانات حرفياً. الخريطة تصف المسار
 * الأمامي وحده — من الاستقبال إلى تحويل الطلب — ولا تصف التعويضات.
 *
 * التراجع التعويضي (مثل استرجاع الحالة السابقة عند إلغاء استثناء مخاطرة في
 * `apps/admin/app/exceptions/actions.ts`) عمداً خارج هذه الخريطة: هو إلغاء
 * لأثر عملية سابقة داخل معاملة واحدة، لا انتقال جديد في دورة حياة الطلب.
 * إدخاله هنا كان سيفتح كل انتقال عكسي أمام الإدخال اليدوي.
 */
export type RfqState =
  | 'DRAFT'
  | 'NEED_MORE_INFO'
  | 'FITMENT_REVIEW'
  | 'SOURCING_LOCAL'
  | 'SOURCING_GLOBAL'
  | 'QUOTES_READY'
  | 'CUSTOMER_SELECTED'
  | 'CONVERTED_TO_ORDER'
  | 'CANCELLED';

/** الإلغاء متاح من أي حالة حيّة: لا مال محتجزاً على مستوى الـRFQ بعد. */
const CANCELLABLE: readonly RfqState[] = ['CANCELLED'];

export const RFQ_TRANSITIONS: Readonly<
  Record<RfqState, readonly RfqState[]>
> = Object.freeze({
  // الاستقبال يكتب NEED_MORE_INFO أو FITMENT_REVIEW مباشرة حسب اكتمال البيانات،
  // فـDRAFT تبقى نقطة بدء للطلبات المحفوظة قبل اكتمالها.
  DRAFT: ['NEED_MORE_INFO', 'FITMENT_REVIEW', ...CANCELLABLE],
  // العميل أكمل الناقص: يعود إلى بوابة التوافق، أو إلى البحث مباشرة إن كانت
  // القطعة محدَّدة برقم أصلي لا يحتاج تحقق توافق.
  NEED_MORE_INFO: ['FITMENT_REVIEW', 'SOURCING_LOCAL', ...CANCELLABLE],
  // بوابة Rule 5: لا يبدأ البحث قبل تثبيت التوافق، وقد ترتدّ لطلب بيانات أدق.
  FITMENT_REVIEW: ['NEED_MORE_INFO', 'SOURCING_LOCAL', ...CANCELLABLE],
  // المحلي أولاً؛ التصعيد للدولي فرع لا محطة إلزامية.
  SOURCING_LOCAL: ['SOURCING_GLOBAL', 'QUOTES_READY', ...CANCELLABLE],
  SOURCING_GLOBAL: ['QUOTES_READY', ...CANCELLABLE],
  // العميل قد يعتمد عرضاً مباشرة من شاشة المقارنة دون خطوة اختيار منفصلة،
  // فالمساران قائمان: عبر CUSTOMER_SELECTED أو إلى التحويل رأساً.
  QUOTES_READY: [
    'CUSTOMER_SELECTED',
    'CONVERTED_TO_ORDER',
    'SOURCING_GLOBAL',
    ...CANCELLABLE,
  ],
  CUSTOMER_SELECTED: ['CONVERTED_TO_ORDER', ...CANCELLABLE],
  // نهائيتان: بعد التحويل تحكم دورةُ حياة الطلب، وبعد الإلغاء لا شيء.
  CONVERTED_TO_ORDER: [],
  CANCELLED: [],
});

export const TERMINAL_RFQ_STATES: readonly RfqState[] = Object.freeze([
  'CONVERTED_TO_ORDER',
  'CANCELLED',
]);

export function isTerminalRfqState(state: RfqState): boolean {
  return RFQ_TRANSITIONS[state].length === 0;
}

export function canTransitionRfq(from: RfqState, to: RfqState): boolean {
  return RFQ_TRANSITIONS[from].includes(to);
}

export class RfqTransitionError extends Error {
  readonly from: RfqState;
  readonly to: RfqState;

  constructor(from: RfqState, to: RfqState) {
    super(`rfq transition ${from} → ${to} is not allowed`);
    this.name = 'RfqTransitionError';
    this.from = from;
    this.to = to;
  }
}

/** يرمي بدل أن يعيد قيمة صامتة: انتقال RFQ غير مسموح خطأ برمجي. */
export function assertRfqTransition(from: RfqState, to: RfqState): void {
  if (!canTransitionRfq(from, to)) {
    throw new RfqTransitionError(from, to);
  }
}
