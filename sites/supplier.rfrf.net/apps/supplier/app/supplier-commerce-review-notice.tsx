import { prisma } from '@rafraf/db';

/** Rendered only after the portal has resolved its authenticated supplier. */
export async function SupplierCommerceReviewNotice({
  supplierId,
}: {
  supplierId: string;
}) {
  const review = await prisma.riskAssessment.findFirst({
    where: { entityType: 'supplier', entityId: supplierId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { riskLevel: true },
  });
  if (review?.riskLevel === 'LOW' || review?.riskLevel === 'MEDIUM')
    return null;
  return (
    <aside className="sp-alert" role="status">
      <strong>يلزم استكمال مراجعة الحساب قبل إتاحة العروض للعملاء.</strong>
      <p>
        يمكنك تجهيز الكتالوج وإرسال العروض للمراجعة. تواصل مع إدارة رفرف
        لاستكمال الخطوة المطلوبة؛ تقديم العرض لا يعني بدء طلب مدفوع.
      </p>
    </aside>
  );
}
