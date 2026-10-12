export function trackCodeInputError(code: string): string | null {
  return code.trim() ? null : 'أدخل رقم الطلب أو طلب التسعير أولاً.';
}
