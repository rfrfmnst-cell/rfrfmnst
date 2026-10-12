import {
  COMPLIANCE_REVIEW_ORDER_STATUSES,
  orderComplianceStatus,
  reviewMatchesPart,
} from '@rafraf/shared/workflow/order-compliance';
import type { AdminRfqDetail } from '../../../lib/admin-rfq-detail';
import { otoClaimBlocksCompliance } from '@rafraf/shared/workflow/oto-claim';
import { ComplianceReviewForm } from './compliance-review-form';

export function CompliancePanel({
  order,
  rfqId,
  canReview,
}: {
  order: AdminRfqDetail['orders'][number];
  rfqId: string;
  canReview: boolean;
}) {
  const state = orderComplianceStatus(order);
  const latest = order.complianceCases[0];
  const shipmentClaimed = order.shipments.some(otoClaimBlocksCompliance);
  const labels: Record<string, string> = {
    PENDING: 'بانتظار المراجعة',
    UNDER_REVIEW: 'قيد المراجعة',
    APPROVED: 'معتمد',
    REJECTED: 'مرفوض',
    NOT_REQUIRED: 'غير مطلوب',
  };
  return (
    <section className="card-block">
      <h2>الامتثال قبل الشحن</h2>
      <p>
        شهادات SABER/SASO:{' '}
        {state.required ? 'مطلوبة قبل الشحن' : 'غير مطلوبة للتصنيف الحالي'}
      </p>
      <p>
        {state.cleared
          ? 'مستوفٍ لشروط الامتثال الحالية.'
          : 'الشحن متوقف حتى استيفاء مراجعة الامتثال.'}
      </p>
      <p>
        حالة المراجعة:{' '}
        {latest ? labels[latest.reviewStatus] : 'لم تُفتح مراجعة للتصنيف'}
      </p>
      {!state.part ? (
        <p role="alert">يلزم ربط قطعة مصنفة ومتطابقة بالعرض والطلب.</p>
      ) : null}
      {shipmentClaimed ? (
        <p>
          بدأ حجز شحنة OTO؛ يتطلب تغيير الاعتماد مراجعة العمليات ومصالحة الشحنة.
        </p>
      ) : null}
      {canReview &&
      !shipmentClaimed &&
      state.part &&
      COMPLIANCE_REVIEW_ORDER_STATUSES.includes(order.status) ? (
        <ComplianceReviewForm
          key={latest?.updatedAt.toISOString() ?? 'new'}
          orderId={order.id}
          rfqId={rfqId}
          caseId={latest?.id ?? ''}
          updatedAt={latest?.updatedAt.toISOString() ?? ''}
          reviewing={
            latest?.reviewStatus === 'UNDER_REVIEW' &&
            reviewMatchesPart(latest, state.part)
          }
          required={state.required}
        />
      ) : null}
    </section>
  );
}
