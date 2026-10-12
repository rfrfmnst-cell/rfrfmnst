export function humanVerificationMessage(
  siteKey: string,
  failed: boolean,
): string {
  if (!siteKey) {
    return 'لا يمكن المتابعة مؤقتاً لأن خدمة التحقق البشري لم تبدأ.';
  }
  if (failed) {
    return 'تعذّر تحميل التحقق البشري. حدّث الصفحة وحاول مجدداً.';
  }
  return '';
}
