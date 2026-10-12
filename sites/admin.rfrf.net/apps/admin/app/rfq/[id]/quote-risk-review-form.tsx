'use client';

import { useActionState } from 'react';
import { recordQuoteRiskReview } from './quote-risk-review-actions';

export function QuoteRiskReviewForm({
  quoteId,
  rfqId,
  riskLevel,
}: {
  quoteId: string;
  rfqId: string;
  riskLevel: string;
}) {
  const [state, action, pending] = useActionState(recordQuoteRiskReview, {});
  const labels: Record<string, string> = {
    LOW: 'منخفض',
    MEDIUM: 'متوسط',
    HIGH: 'مرتفع',
    BLOCKED: 'محظور',
  };
  return (
    <form action={action} className="q-price-form">
      <input type="hidden" name="quoteId" value={quoteId} />
      <input type="hidden" name="rfqId" value={rfqId} />
      <input type="hidden" name="riskLevel" value={riskLevel} />
      <label>
        <input type="checkbox" name="confirmed" required /> راجعت العرض ومستوى
        الخطر الحالي: {labels[riskLevel] ?? 'غير معروف'}
      </label>
      <button type="submit" disabled={pending}>
        {pending ? 'جارٍ التوثيق…' : 'توثيق مراجعة العرض'}
      </button>
      {state.message ? <p role="status">{state.message}</p> : null}
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
