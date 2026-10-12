'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminPermission } from '../../../lib/require-admin-session';
import { recordExistingQuoteReview } from '../../../lib/legacy-quote-risk-review';

export async function recordQuoteRiskReview(
  _state: { message?: string; error?: string },
  formData: FormData,
): Promise<{ message?: string; error?: string }> {
  const admin = await requireAdminPermission('RISK_REVIEW');
  const rfqId = String(formData.get('rfqId') ?? '');
  const quoteId = String(formData.get('quoteId') ?? '');
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(rfqId) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(quoteId)
  ) {
    return { error: 'بيانات المراجعة غير صالحة.' };
  }
  const result = await recordExistingQuoteReview({
    quoteId,
    rfqId,
    actorId: admin.userId,
    expectedRiskLevel: String(formData.get('riskLevel') ?? ''),
    confirmed: formData.get('confirmed') === 'on',
  });
  if (result === 'NOT_AVAILABLE')
    return { error: 'العرض غير متاح للمراجعة أو لم تؤكد المراجعة.' };
  if (result === 'REVIEW_CHANGED')
    return { error: 'تغير التقييم. حدّث الصفحة وراجعه مجدداً.' };
  revalidatePath(`/rfq/${rfqId}`);
  revalidatePath('/exceptions');
  return {
    message:
      result === 'RECORDED'
        ? 'تم توثيق المراجعة.'
        : 'توجد مراجعة مسجلة؛ لم تُستبدل.',
  };
}
