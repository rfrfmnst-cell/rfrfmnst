export interface SupplierFormState {
  ok?: boolean;
  error?: string;
  values?: Record<string, string>;
}

/**
 * مدخل توافق للواجهة القديمة فقط. التسجيل القانوني الحقيقي يتم حصراً في
 * بوابة الموردين حيث OTP والمستندات الخاصة والمراجعة الإدارية.
 */
export async function submitSupplierUseCase(
  ..._arguments: [SupplierFormState, FormData]
): Promise<SupplierFormState> {
  void _arguments;
  return {
    error:
      'انتقل إلى بوابة الموردين لإكمال التحقق من الجوال ورفع مستند المنشأة.',
  };
}
