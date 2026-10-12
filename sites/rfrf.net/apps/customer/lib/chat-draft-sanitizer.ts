import { normalizeVin } from './vin.ts';

/** الحقول المسموح بمرورها من مسودة المحادثة إلى منطق النطاق. */
export interface SanitizedChatDraft {
  partText?: string;
  oemNumber?: string;
  vin?: string;
  make?: string;
  model?: string;
  year?: string;
  phone?: string;
  fullName?: string;
}

const DRAFT_FIELDS = [
  'partText',
  'oemNumber',
  'vin',
  'make',
  'model',
  'year',
  'phone',
  'fullName',
] as const;

const DRAFT_LIMITS: Record<(typeof DRAFT_FIELDS)[number], number> = {
  partText: 240,
  oemNumber: 40,
  vin: 24,
  make: 60,
  model: 80,
  year: 4,
  phone: 16,
  fullName: 100,
};

/** منقّي حتمي بلا اتصال بنموذج أو اعتماد على متغيرات البيئة. */
export function sanitizeChatDraft(value: unknown): SanitizedChatDraft {
  if (!value || typeof value !== 'object') return {};
  const source = value as Record<string, unknown>;
  const clean: SanitizedChatDraft = {};
  for (const field of DRAFT_FIELDS) {
    const raw = source[field];
    if (typeof raw !== 'string') continue;
    const normalized = raw.trim().slice(0, DRAFT_LIMITS[field]);
    if (normalized) clean[field] = normalized;
  }
  if (clean.year && !/^(?:19[8-9]\d|20[0-2]\d)$/.test(clean.year)) {
    delete clean.year;
  }
  if (clean.phone) {
    const phone = clean.phone.replace(/[\s-]/g, '');
    if (!/^(?:05\d{8}|(?:\+?966)5\d{8})$/.test(phone)) delete clean.phone;
    else clean.phone = phone;
  }
  if (clean.vin) {
    const vin = normalizeVin(clean.vin);
    if (vin) clean.vin = vin;
    else delete clean.vin;
  }
  return clean;
}
