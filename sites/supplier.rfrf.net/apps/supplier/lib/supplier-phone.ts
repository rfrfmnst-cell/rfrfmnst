import { normalizeAuthDigits } from './auth-input.ts';
const E164_PHONE = /^\+[1-9]\d{7,14}$/u;

export function normalizeSupplierPhone(
  value: FormDataEntryValue | string | null,
): string | null {
  const compact = normalizeAuthDigits(String(value ?? ''))
    .trim()
    .replace(/[\s().-]/gu, '');
  if (compact.startsWith('05') && !/^05\d{8}$/u.test(compact)) return null;
  const normalized = compact.startsWith('00')
    ? `+${compact.slice(2)}`
    : compact.startsWith('05')
      ? `+9665${compact.slice(2)}`
      : compact.startsWith('9665')
        ? `+${compact}`
        : compact;
  return E164_PHONE.test(normalized) ? normalized : null;
}

export function isCanonicalSupplierPhone(value: unknown): value is string {
  return typeof value === 'string' && normalizeSupplierPhone(value) === value;
}
