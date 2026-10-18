/** Normalize numeric authentication input only; never apply to passwords. */
export function normalizeAuthDigits(value: string): string {
  return value.replace(/[\u0660-\u0669\u06f0-\u06f9]/gu, (digit) =>
    String(
      digit.charCodeAt(0) - (digit.charCodeAt(0) >= 0x06f0 ? 0x06f0 : 0x0660),
    ),
  );
}

export function normalizeOtpCode(value: string): string {
  return normalizeAuthDigits(value).trim();
}
