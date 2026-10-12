/**
 * RFQ intake triage - pure operational AI guardrail.
 *
 * This is not fitment matching. It scores whether the customer request is
 * complete enough to enter the operations workflow and whether a human must
 * review it before sourcing.
 */

export type IntakeRecommendedStatus = 'NEED_MORE_INFO' | 'FITMENT_REVIEW';

export interface IntakeTriageInput {
  fullName?: string;
  phone?: string;
  make?: string;
  model?: string;
  year?: number | string;
  partText?: string;
  oemNumber?: string;
  vin?: string;
  notes?: string;
  imagesCount?: number;
  channel?: 'WEB' | 'WHATSAPP' | 'ADMIN';
}

export interface IntakeEvidence {
  field: string;
  source: 'customer_text' | 'customer_image' | 'system_rule';
  value?: string | number | boolean;
  confidence: number;
}

export interface IntakeTriageResult {
  workflow: 'rfq_intake_triage';
  version: '2026-07-12';
  normalized: {
    customer: { fullName?: string; phone?: string };
    vehicle: { make?: string; model?: string; year?: number; vin?: string };
    item: { partText?: string; oemNumber?: string; quantity: 1 };
    channel: 'WEB' | 'WHATSAPP' | 'ADMIN';
  };
  missingFields: string[];
  evidence: IntakeEvidence[];
  riskFlags: string[];
  recommendedStatus: IntakeRecommendedStatus;
  humanReviewRequired: boolean;
  confidence: number;
  nextActions: string[];
}

const REQUIRED_FIELDS = [
  'fullName',
  'phone',
  'partText',
  'make',
  'model',
  'year',
] as const;

const SENSITIVE_PART_PATTERNS = [
  /فرامل|فحمات|هوبات|مكابح/i,
  /ايرباق|إيرباق|وسادة/i,
  /abs|حساس|كمبيوتر|ecu/i,
  /قير|ناقل|محرك|مكينة/i,
  /دركسون|تعليق|مساعد/i,
];

const normalizeText = (v?: string): string | undefined => {
  const s = v?.trim().replace(/\s+/g, ' ');
  return s || undefined;
};

const normalizeIdentifier = (v?: string): string | undefined =>
  normalizeText(v)?.replace(/\s+/g, '').toUpperCase();

export function isValidVin(v?: string): boolean {
  return Boolean(v && /^[A-HJ-NPR-Z0-9]{17}$/.test(v));
}

export function isPlausibleOemNumber(v?: string): boolean {
  return Boolean(
    v &&
    v.length >= 5 &&
    v.length <= 24 &&
    /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(v) &&
    /[0-9]/.test(v),
  );
}

function normalizeYear(raw?: number | string): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 1980 || n > 2027) return undefined;
  return n;
}

function pushEvidence(
  evidence: IntakeEvidence[],
  field: string,
  value: string | number | boolean | undefined,
  confidence: number,
  source: IntakeEvidence['source'] = 'customer_text',
) {
  if (value == null || value === '') return;
  evidence.push({ field, source, value, confidence });
}

export function triageRfqIntake(input: IntakeTriageInput): IntakeTriageResult {
  const fullName = normalizeText(input.fullName);
  const phone = normalizeText(input.phone);
  const make = normalizeText(input.make);
  const model = normalizeText(input.model);
  const year = normalizeYear(input.year);
  const partText = normalizeText(input.partText);
  const oemNumber = normalizeIdentifier(input.oemNumber);
  const vin = normalizeIdentifier(input.vin);
  const validOemNumber = isPlausibleOemNumber(oemNumber);
  const validVin = isValidVin(vin);
  const channel = input.channel ?? 'WEB';

  const missingFields = REQUIRED_FIELDS.filter((field) => {
    if (field === 'year') return !year;
    return !normalizeText(String(input[field] ?? ''));
  });

  const evidence: IntakeEvidence[] = [];
  pushEvidence(evidence, 'fullName', fullName, 0.78);
  pushEvidence(evidence, 'phone', phone, 0.94);
  pushEvidence(evidence, 'partText', partText, 0.72);
  pushEvidence(evidence, 'make', make, 0.72);
  pushEvidence(evidence, 'model', model, 0.66);
  pushEvidence(evidence, 'year', year, 0.9);
  pushEvidence(evidence, 'oemNumber', oemNumber, validOemNumber ? 0.88 : 0.25);
  pushEvidence(evidence, 'vin', vin, validVin ? 0.9 : 0.2);
  if ((input.imagesCount ?? 0) > 0) {
    pushEvidence(
      evidence,
      'imagesCount',
      input.imagesCount,
      0.7,
      'customer_image',
    );
  }

  const riskFlags: string[] = [];
  if (partText && SENSITIVE_PART_PATTERNS.some((rx) => rx.test(partText))) {
    riskFlags.push('sensitive_part_requires_technical_review');
  }
  if (oemNumber && !validOemNumber) riskFlags.push('invalid_oem_format');
  if (vin && !validVin) riskFlags.push('invalid_vin_format');
  if (!validOemNumber && !validVin) riskFlags.push('fitment_evidence_weak');
  if ((input.imagesCount ?? 0) > 0 && !partText) {
    riskFlags.push('image_only_request_needs_human_labeling');
  }
  if (year && year >= 2026) riskFlags.push('new_model_year_catalog_gap_risk');

  const completeness =
    (REQUIRED_FIELDS.length - missingFields.length) / REQUIRED_FIELDS.length;
  const evidenceBonus = Math.min(0.15, evidence.length * 0.015);
  const riskPenalty = Math.min(0.28, riskFlags.length * 0.08);
  const confidence = Math.max(
    0.05,
    Math.min(
      0.98,
      Number((completeness * 0.85 + evidenceBonus - riskPenalty).toFixed(2)),
    ),
  );

  const recommendedStatus: IntakeRecommendedStatus = missingFields.length
    ? 'NEED_MORE_INFO'
    : 'FITMENT_REVIEW';
  const humanReviewRequired =
    missingFields.length > 0 ||
    riskFlags.length > 0 ||
    (!validOemNumber && !validVin) ||
    confidence < 0.85;

  const nextActions = missingFields.length
    ? [
        `اطلب من العميل: ${missingFields.join(', ')}`,
        'لا تبدأ sourcing قبل اكتمال الحقول الأساسية.',
      ]
    : [
        'ابدأ مراجعة التوافق قبل طلب عروض الموردين.',
        validOemNumber || validVin
          ? 'استخدم OEM/VIN كدليل أول في المطابقة.'
          : 'اطلب OEM أو VIN من العميل إن أمكن قبل اعتماد القطعة.',
      ];

  return {
    workflow: 'rfq_intake_triage',
    version: '2026-07-12',
    normalized: {
      customer: { fullName, phone },
      vehicle: { make, model, year, vin },
      item: { partText, oemNumber, quantity: 1 },
      channel,
    },
    missingFields,
    evidence,
    riskFlags,
    recommendedStatus,
    humanReviewRequired,
    confidence,
    nextActions,
  };
}
