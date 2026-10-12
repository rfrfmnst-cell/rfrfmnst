/**
 * آلتا حالة الامتثال — خريطتا انتقالات صريحتان فوق `ComplianceReviewStatus`
 * و`CertificateStatus` في schema.prisma.
 *
 * الحالات ليست مخترعة هنا: هي تعداد قاعدة البيانات حرفياً. الامتثال آلتان لا
 * آلة واحدة، لأنهما تجيبان سؤالين مختلفين: المراجعة قرارٌ يتخذه فريق العمليات
 * على حالة بعينها، والشهادة مستندٌ له صلاحية تنتهي بمرور الوقت.
 *
 * مرجع التصميم: docs/COMPLIANCE.md (صمّم الآن، اربط بـSABER/SASO لاحقاً).
 */
export type ComplianceReviewState =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED';

export const COMPLIANCE_REVIEW_TRANSITIONS: Readonly<
  Record<ComplianceReviewState, readonly ComplianceReviewState[]>
> = Object.freeze({
  // «غير مطلوب» ليست نهاية: تصنيف القطعة قد يتغيّر فيصير الامتثال لازماً.
  NOT_REQUIRED: ['PENDING'],
  // قد تسقط الحاجة أيضاً إذا تبيّن أن البند خارج نطاق التنظيم.
  PENDING: ['UNDER_REVIEW', 'NOT_REQUIRED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED'],
  // القرار نهائي على هذا السجل. إعادة النظر تفتح سجل مراجعة جديداً، فيبقى
  // أثر القرار الأول قائماً للتدقيق بدل أن يُكتب فوقه.
  APPROVED: [],
  REJECTED: [],
});

export type CertificateState =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED';

export const CERTIFICATE_TRANSITIONS: Readonly<
  Record<CertificateState, readonly CertificateState[]>
> = Object.freeze({
  NOT_REQUIRED: ['PENDING'],
  PENDING: ['SUBMITTED', 'NOT_REQUIRED'],
  SUBMITTED: ['APPROVED', 'REJECTED'],
  // على خلاف المراجعة، الشهادة مستند حيّ: تنتهي صلاحيته فيُطلب تجديده.
  APPROVED: ['EXPIRED'],
  // الرفض والانتهاء كلاهما يعيد المورد إلى تقديم مستند جديد على السجل نفسه.
  REJECTED: ['PENDING'],
  EXPIRED: ['PENDING'],
});

export function canTransitionComplianceReview(
  from: ComplianceReviewState,
  to: ComplianceReviewState,
): boolean {
  return COMPLIANCE_REVIEW_TRANSITIONS[from].includes(to);
}

export function canTransitionCertificate(
  from: CertificateState,
  to: CertificateState,
): boolean {
  return CERTIFICATE_TRANSITIONS[from].includes(to);
}

/** يسمح بالشحن: إما لا امتثال مطلوباً أصلاً، أو صدرت الموافقة. */
export function complianceClearsShipping(
  state: ComplianceReviewState,
): boolean {
  return state === 'NOT_REQUIRED' || state === 'APPROVED';
}

export class ComplianceTransitionError extends Error {
  readonly from: string;
  readonly to: string;

  constructor(machine: 'review' | 'certificate', from: string, to: string) {
    super(`compliance ${machine} transition ${from} → ${to} is not allowed`);
    this.name = 'ComplianceTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function assertComplianceReviewTransition(
  from: ComplianceReviewState,
  to: ComplianceReviewState,
): void {
  if (!canTransitionComplianceReview(from, to)) {
    throw new ComplianceTransitionError('review', from, to);
  }
}

export function assertCertificateTransition(
  from: CertificateState,
  to: CertificateState,
): void {
  if (!canTransitionCertificate(from, to)) {
    throw new ComplianceTransitionError('certificate', from, to);
  }
}
