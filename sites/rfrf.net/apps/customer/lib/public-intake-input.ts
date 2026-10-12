/** Collapses controls/newlines and bounds untrusted public form text by code point. */
export function publicIntakeText(
  value: unknown,
  maxCodePoints: number,
): string {
  return Array.from(
    String(value ?? '')
      .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim(),
  )
    .slice(0, maxCodePoints)
    .join('');
}
