const SAUDI_PHONE = /^(?:\+9665|05|9665)\d{8}$/;

export function normalizeSaudiPhone(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '');
  if (!SAUDI_PHONE.test(digits)) return null;
  if (digits.startsWith('+9665')) return digits;
  if (digits.startsWith('9665')) return `+${digits}`;
  return `+966${digits.slice(1)}`;
}
