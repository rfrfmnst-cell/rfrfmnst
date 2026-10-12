/**
 * آلة حالة المورد — خريطة انتقالات صريحة فوق `SupplierStatus` في schema.prisma.
 *
 * الحالات ليست مخترعة هنا: هي تعداد قاعدة البيانات حرفياً. على خلاف الطلب
 * والشحنة، دورة حياة المورد ليست خطاً واحداً: التقييد والإيقاف حالتان
 * تشغيليتان يُرجع منهما المورد إلى العمل، لا نهايتان.
 */
export type SupplierState =
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'LIMITED'
  | 'SUSPENDED'
  | 'REJECTED';

export const SUPPLIER_TRANSITIONS: Readonly<
  Record<SupplierState, readonly SupplierState[]>
> = Object.freeze({
  // التسجيل يبدأ معلّقاً حتى يبدأ فريق العمليات المراجعة.
  PENDING: ['UNDER_REVIEW', 'REJECTED'],
  // المراجعة قد تنتهي باعتماد كامل أو باعتماد مقيّد (فئات أو سقف محدود).
  UNDER_REVIEW: ['APPROVED', 'LIMITED', 'REJECTED'],
  // مورد عامل: يُقيَّد عند تدهور الأداء، أو يُوقف عند مخالفة.
  APPROVED: ['LIMITED', 'SUSPENDED'],
  // التقييد قابل للرفع بالعودة إلى APPROVED، أو للتصعيد إلى الإيقاف.
  LIMITED: ['APPROVED', 'SUSPENDED'],
  // الإيقاف مؤقت بطبعه: إما يعود المورد بشروط، أو يُرفض نهائياً.
  SUSPENDED: ['APPROVED', 'LIMITED', 'REJECTED'],
  // الرفض وحده نهائي: عودة المورد تكون بتسجيل جديد لا بإحياء السجل القديم.
  REJECTED: [],
});

export const TERMINAL_SUPPLIER_STATES: readonly SupplierState[] = Object.freeze(
  ['REJECTED'],
);

export function isTerminalSupplierState(state: SupplierState): boolean {
  return SUPPLIER_TRANSITIONS[state].length === 0;
}

export function canTransitionSupplier(
  from: SupplierState,
  to: SupplierState,
): boolean {
  return SUPPLIER_TRANSITIONS[from].includes(to);
}

/**
 * استقبال RFQ مقصور مؤقتاً على الاعتماد الكامل. LIMITED حالة قراءة فقط
 * fail-closed حتى يملك نموذج البيانات نطاقاً صريحاً للفئات أو سقفاً مالياً؛
 * السماح بعرض لا يستطيع المورد قبول طلبه المدفوع يصنع مأزق تنفيذ.
 */
export function canSupplierReceiveRfqs(state: SupplierState): boolean {
  return state === 'APPROVED';
}

export class SupplierTransitionError extends Error {
  readonly from: SupplierState;
  readonly to: SupplierState;

  constructor(from: SupplierState, to: SupplierState) {
    super(`supplier transition ${from} → ${to} is not allowed`);
    this.name = 'SupplierTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function assertSupplierTransition(
  from: SupplierState,
  to: SupplierState,
): void {
  if (!canTransitionSupplier(from, to)) {
    throw new SupplierTransitionError(from, to);
  }
}
