/**
 * سياسة تسوية الضمان — نقية بلا قاعدة بيانات ولا شبكة، ليبقى قرار المال
 * قابلاً للاختبار وحده.
 *
 * النموذج هجين: الإفراج آلي في المسار الطبيعي، وتحت مظلّة مراجعة بشرية عند
 * الخطر. لا يوجد مسار ثالث يترك مبلغاً محتجزاً بلا قرار.
 */

/**
 * طول نافذة الشكوى الافتراضي بالساعات.
 *
 * ٧٢ ساعة توازن عملي: وقت كافٍ ليفحص العميل القطعة ويجرّب تركيبها، ودورة نقد
 * لا تطرد الموردين. القيمة قابلة للضبط عبر `COMPLAINT_WINDOW_HOURS` تحديداً
 * لأن مدّة الإرجاع النظامية قد تفرض رقماً مختلفاً — تُضبط على ما يقرّره المستشار
 * القانوني، ولا تُترك على الافتراضي لمجرّد أنه موجود.
 */
export const DEFAULT_COMPLAINT_WINDOW_HOURS = 72;

const MIN_COMPLAINT_WINDOW_HOURS = 1;
const MAX_COMPLAINT_WINDOW_HOURS = 24 * 60;

export type SettlementRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';

/**
 * المستويات التي توقف الإفراج الآلي وتحوّله إلى مراجعة بشرية. تطابق ما يلتقطه
 * طابور الاستثناءات في لوحة العمليات، فلا تنشأ عتبتان للخطر تختلفان بصمت.
 */
export const ESCALATING_RISK_LEVELS: readonly SettlementRiskLevel[] = [
  'HIGH',
  'BLOCKED',
];

export type SettlementDecision =
  'RELEASE' | 'WINDOW_OPEN' | 'ESCALATE_TO_OPS' | 'BLOCKED_BY_COMPLAINT';

export interface SettlementDecisionInput {
  deliveredAt: Date;
  now: Date;
  windowHours: number;
  riskLevel?: SettlementRiskLevel | null;
  hasOpenComplaint: boolean;
  /** تأكيد استلام صريح من العميل ينهي انتظار النافذة. */
  customerConfirmed: boolean;
}

export function resolveComplaintWindowHours(raw: unknown): number {
  const parsed =
    typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_COMPLAINT_WINDOW_HOURS;
  const whole = Math.floor(parsed);
  if (whole < MIN_COMPLAINT_WINDOW_HOURS) return DEFAULT_COMPLAINT_WINDOW_HOURS;
  if (whole > MAX_COMPLAINT_WINDOW_HOURS) return MAX_COMPLAINT_WINDOW_HOURS;
  return whole;
}

export function complaintWindowClosesAt(
  deliveredAt: Date,
  windowHours: number,
): Date {
  return new Date(deliveredAt.getTime() + windowHours * 60 * 60 * 1000);
}

/**
 * قرار الإفراج. الترتيب مقصود: الشكوى تسبق كل شيء، ثم الخطر، ثم الوقت.
 *
 * تأكيد العميل يختصر الانتظار ولا يتجاوز الشكوى ولا الخطر — لأن الضغط على زرّ
 * ليس تنازلاً عن حماية، والطرف الذي أكّد قد يكون هو نفسه الذي يشتكي بعد ساعة.
 */
export function decideSettlement(
  input: SettlementDecisionInput,
): SettlementDecision {
  if (input.hasOpenComplaint) return 'BLOCKED_BY_COMPLAINT';

  if (input.riskLevel !== 'LOW' && input.riskLevel !== 'MEDIUM') {
    return 'ESCALATE_TO_OPS';
  }

  if (input.customerConfirmed) return 'RELEASE';

  const closesAt = complaintWindowClosesAt(
    input.deliveredAt,
    input.windowHours,
  );
  return input.now.getTime() >= closesAt.getTime() ? 'RELEASE' : 'WINDOW_OPEN';
}

export interface EscrowSplitInput {
  /** ما دفعه العميل ودخل الضمان. */
  totalAmount: number;
  /** مستحقّ المورد عن القطعة كما ثبّته احتساب التكلفة الواصلة. */
  supplierPrice: number;
}

export interface EscrowSplit {
  /** ما يخرج من الضمان بالكامل. */
  release: number;
  /** ما يذهب للمورد. */
  payout: number;
  /** ما تحتفظ به رفرف: الهامش وما تحمّلته من تكاليف. */
  fee: number;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * يقسم المبلغ المحتجز إلى مستحقّ المورد وما تحتفظ به رفرف.
 *
 * القسمة مفروضة حسابياً لا مختارة: `totalLandedCost` في محرّك التسعير هو سعر
 * العميل نفسه، وأحد مركّباته `supplierPrice`. فالباقي — الشحن والجمارك والرسوم
 * والاحتياط والهامش — هو ما تحمّلته رفرف وتحتفظ به.
 *
 * الثابت `release === payout + fee` يُتحقَّق منه هنا لا في الاختبار وحده، لأن
 * قيداً غير متوازن في الدفتر لا يمكن تسويته بأثر رجعي بعد آلاف الطلبات.
 */
export function splitEscrowSettlement(input: EscrowSplitInput): EscrowSplit {
  const release = round2(input.totalAmount);
  const payout = round2(input.supplierPrice);

  if (!Number.isFinite(release) || !Number.isFinite(payout)) {
    throw new Error('Escrow settlement requires finite amounts');
  }
  if (release <= 0) {
    throw new Error('Escrow settlement requires a positive held amount');
  }
  if (payout < 0) {
    throw new Error('Supplier payout cannot be negative');
  }
  if (payout > release) {
    throw new Error('Supplier payout cannot exceed the amount held in escrow');
  }

  const fee = round2(release - payout);
  if (round2(payout + fee) !== release) {
    throw new Error('Escrow settlement does not balance');
  }

  return { release, payout, fee };
}
