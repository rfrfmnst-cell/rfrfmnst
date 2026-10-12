'use client';

import { useActionState } from 'react';
import { recordComplianceReview } from './compliance-review-actions';

export function ComplianceReviewForm({
  orderId,
  rfqId,
  caseId,
  updatedAt,
  reviewing,
  required,
}: {
  orderId: string;
  rfqId: string;
  caseId: string;
  updatedAt: string;
  reviewing: boolean;
  required: boolean;
}) {
  const [state, action, pending] = useActionState(recordComplianceReview, {});
  return (
    <form action={action} className="q-price-form">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="rfqId" value={rfqId} />
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="updatedAt" value={updatedAt} />
      {reviewing ? (
        <>
          {required ? (
            <>
              <label>
                مرجع شهادة المنتج PCoC
                <input name="pcocReference" maxLength={120} dir="ltr" />
              </label>
              <label>
                مرجع شهادة الشحنة SCoC
                <input name="scocReference" maxLength={120} dir="ltr" />
              </label>
              <p className="hint">
                تحقق من صلاحية الشهادتين ومطابقتهما للقطعة والشحنة. هذه مراجعة
                بشرية؛ لا يجري اتصال بسابر.
              </p>
            </>
          ) : null}
          <label>
            <input type="checkbox" name="confirmed" required /> راجعت التصنيف
            والمستندات واتخذت القرار.
          </label>
          <button name="decision" value="APPROVE" disabled={pending}>
            اعتماد الامتثال
          </button>
          <button name="decision" value="REJECT" disabled={pending}>
            رفض الامتثال
          </button>
        </>
      ) : (
        <button name="decision" value="START_REVIEW" disabled={pending}>
          فتح مراجعة امتثال
        </button>
      )}
      {state.message ? <p role="status">{state.message}</p> : null}
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
