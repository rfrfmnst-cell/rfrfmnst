'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminPermission } from '../../../lib/require-admin-session';
import { reviewOrderCompliance } from '../../../lib/order-compliance-review';

export async function recordComplianceReview(
  _state: { message?: string; error?: string },
  formData: FormData,
): Promise<{ message?: string; error?: string }> {
  const admin = await requireAdminPermission('RISK_REVIEW');
  const field = (key: string) => String(formData.get(key) ?? '').trim();
  const result = await reviewOrderCompliance({
    actorId: admin.userId,
    orderId: field('orderId'),
    rfqId: field('rfqId'),
    decision: field('decision'),
    expectedCaseId: field('caseId'),
    expectedUpdatedAt: field('updatedAt'),
    confirmed: formData.get('confirmed') === 'on',
    pcocReference: field('pcocReference'),
    scocReference: field('scocReference'),
  });
  if (result === 'RECORDED' || result === 'REPLAYED') {
    revalidatePath(`/rfq/${field('rfqId')}`);
    revalidatePath('/');
    return {
      message:
        result === 'RECORDED'
          ? 'تم توثيق مراجعة الامتثال.'
          : 'المراجعة مسجلة مسبقاً.',
    };
  }
  const messages: Record<string, string> = {
    PART_REQUIRED: 'اربط القطعة المصنفة بالعرض والطلب قبل المراجعة.',
    CERTIFICATES_REQUIRED:
      'أدخل مرجعين مختلفين لشهادتي المنتج والشحنة بعد التحقق من صلاحيتهما.',
    REVIEW_CHANGED:
      'تغيرت المراجعة أو تصنيف القطعة. حدّث الصفحة وأكد المراجعة مجدداً.',
    NOT_AVAILABLE: 'الطلب غير متاح للمراجعة قبل الشحن.',
    SHIPMENT_CLAIMED:
      'بدأ حجز شحنة OTO؛ راجع العمليات لمصالحة الشحنة قبل تغيير اعتماد الامتثال.',
  };
  return { error: messages[result] ?? 'بيانات المراجعة غير صالحة.' };
}
