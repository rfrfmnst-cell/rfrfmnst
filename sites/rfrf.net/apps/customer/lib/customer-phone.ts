import { normalizeAuthDigits } from './auth-input.ts';

export function normalizeSaudiPhone(
  value: FormDataEntryValue | string | null,
): string | null {
  const raw = normalizeAuthDigits(String(value ?? '')).replace(
    /[\s().-]/gu,
    '',
  );
  const international = raw.startsWith('00') ? '+' + raw.slice(2) : raw;
  const normalized = international.startsWith('05')
    ? '+966' + international.slice(1)
    : international.startsWith('9665')
      ? '+' + international
      : international;
  return /^\+9665\d{8}$/u.test(normalized) ? normalized : null;
}
