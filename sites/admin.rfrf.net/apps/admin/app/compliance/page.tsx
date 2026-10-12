import Link from 'next/link';
import { requireAdminPermission } from '../../lib/require-admin-session';
import { getComplianceQueue } from '../../lib/compliance-queue';

export const dynamic = 'force-dynamic';

export default async function ComplianceQueuePage() {
  await requireAdminPermission('RISK_REVIEW');
  const queue = await getComplianceQueue();
  const reasons: Record<string, string> = {
    PART_UNCLASSIFIED: 'يلزم ربط قطعة مصنفة ومتطابقة',
    REVIEW_REQUIRED: 'يلزم اعتماد مراجعة التصنيف',
    CERTIFICATES_REQUIRED: 'يلزم استكمال اعتماد الشهادات',
  };
  return (
    <main className="ops-card">
      <div className="ops-card-head">
        <h1>مراجعات الامتثال قبل الشحن</h1>
        <Link href="/">مركز العمليات</Link>
      </div>
      <p>طلبات تحتاج إجراءً: {queue.length.toLocaleString('ar-SA')}</p>
      <div className="ops-request-list">
        {queue.map((order) =>
          order.rfqId ? (
            <Link
              className="ops-request"
              key={order.id}
              href={`/rfq/${encodeURIComponent(order.rfqId)}`}
            >
              <strong>{order.code}</strong>
              <span>{reasons[order.reason]}</span>
            </Link>
          ) : (
            <article className="ops-request" key={order.id}>
              <strong>{order.code}</strong>
              <span>
                يلزم ربط الطلب بطلب تسعير عبر العمليات قبل مراجعة الامتثال.
              </span>
            </article>
          ),
        )}
        {!queue.length ? <p>لا توجد طلبات معلقة عند بوابة الامتثال.</p> : null}
      </div>
    </main>
  );
}
