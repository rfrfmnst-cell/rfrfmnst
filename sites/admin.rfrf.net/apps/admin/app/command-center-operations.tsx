import type { Prisma } from '@rafraf/db';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Truck,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { money, pct, timeAgo } from './command-center-format';
import { ar, RFQ_STATUS_AR, SUPPLIER_STATUS_AR } from '../lib/admin-labels';

type DashboardRfq = Prisma.RFQGetPayload<{
  include: {
    customer: { include: { user: true } };
    vehicle: true;
    items: { include: { _count: { select: { quotes: true } } } };
    _count: { select: { evidence: true } };
  };
}>;

type RecentAiDecision = Prisma.AIDecisionGetPayload<{
  select: {
    id: true;
    kind: true;
    confidence: true;
    humanReviewRequired: true;
    entityType: true;
    createdAt: true;
  };
}>;

type PendingSupplier = Prisma.SupplierGetPayload<{
  select: {
    id: true;
    businessName: true;
    city: true;
    status: true;
    createdAt: true;
  };
}>;

interface CommandCenterOperationsProps {
  rfqs: DashboardRfq[];
  aiRecent: RecentAiDecision[];
  aiConfidence: number;
  canReviewSuppliers: boolean;
  pendingSuppliers: PendingSupplier[];
  supplierCounts: {
    approved: number;
    underReview: number;
    pending: number;
  };
  escrowValue: number;
  paymentCount: number;
  disputeCount: number;
  complianceCount: number;
  shipmentCounts: {
    pending: number;
    labelCreated: number;
    inTransit: number;
    delivered: number;
  };
}

const AI_KIND_AR: Record<string, string> = {
  UNDERSTAND_REQUEST: 'فهم الطلب',
  EXTRACT_VIN: 'قراءة VIN',
  EXTRACT_OEM: 'استخراج OEM',
  MATCH_FITMENT: 'مطابقة التوافق',
  SCORE_VENDOR: 'تقييم المورد',
  SCORE_RISK: 'تقييم المخاطر',
  RECOMMEND_QUOTES: 'ترشيح العروض',
};

export function CommandCenterOperations({
  rfqs,
  aiRecent,
  aiConfidence,
  canReviewSuppliers,
  pendingSuppliers,
  supplierCounts,
  escrowValue,
  paymentCount,
  disputeCount,
  complianceCount,
  shipmentCounts,
}: CommandCenterOperationsProps) {
  return (
    <>
      <article className="ops-card span-7" id="requests">
        <div className="ops-card-head">
          <div>
            <p>الطلبات الحية</p>
            <h2>طابور RFQ الذكي</h2>
          </div>
          <span className="ops-pill">{rfqs.length} أحدث طلبات</span>
        </div>
        <div className="ops-request-list">
          {rfqs.map((rfq) => {
            const item = rfq.items[0];
            const confidence = item?.fitmentConfidence ?? null;
            return (
              <Link
                key={rfq.id}
                className="ops-request"
                href={`/rfq/${rfq.id}`}
              >
                <div className="ops-request-main">
                  <span className="mono">{rfq.code}</span>
                  <strong>
                    {rfq.vehicle
                      ? `${rfq.vehicle.make} ${rfq.vehicle.model} ${rfq.vehicle.year}`
                      : (item?.freeTextAr ?? 'طلب جديد')}
                  </strong>
                  <small>
                    {rfq.customer.fullName ||
                      rfq.customer.user.fullName ||
                      'عميل رفرف'}{' '}
                    · {timeAgo(rfq.createdAt)}
                  </small>
                </div>
                <div className="ops-request-meta">
                  <span className={`status s-${rfq.status}`}>
                    {ar(RFQ_STATUS_AR, rfq.status)}
                  </span>
                  <small>
                    عروض {item?._count.quotes ?? 0} · أدلة {rfq._count.evidence}
                  </small>
                </div>
                <div className="ops-fit">
                  <span
                    style={{
                      width: `${Math.max(8, Math.round((confidence ?? 0) * 100))}%`,
                    }}
                  />
                </div>
              </Link>
            );
          })}
          {rfqs.length === 0 ? (
            <p className="empty">لا توجد طلبات بعد.</p>
          ) : null}
        </div>
      </article>

      <article className="ops-card span-5" id="ai">
        <div className="ops-card-head">
          <div>
            <p>AI control</p>
            <h2>جودة القرار</h2>
          </div>
          <Bot size={22} aria-hidden />
        </div>
        <div className="ai-meter">
          <div>
            <strong>{pct(aiConfidence)}</strong>
            <span>متوسط الثقة</span>
          </div>
          <span
            style={
              {
                '--meter': `${Math.round(aiConfidence * 100)}%`,
              } as CSSProperties
            }
          />
        </div>
        <div className="ai-log">
          {aiRecent.map((decision) => (
            <div key={decision.id}>
              <span>
                {decision.humanReviewRequired ? (
                  <AlertTriangle size={16} aria-hidden />
                ) : (
                  <CheckCircle2 size={16} aria-hidden />
                )}
              </span>
              <div>
                <strong>{AI_KIND_AR[decision.kind] ?? decision.kind}</strong>
                <small>
                  {decision.entityType} · {pct(decision.confidence)} ·{' '}
                  {timeAgo(decision.createdAt)}
                </small>
              </div>
            </div>
          ))}
          {aiRecent.length === 0 ? (
            <p className="empty">لا توجد قرارات AI مسجلة حتى الآن.</p>
          ) : null}
        </div>
      </article>

      <article className="ops-card span-4" id="suppliers">
        <div className="ops-card-head">
          <div>
            <p>Supplier gateway</p>
            <h2>اعتماد الموردين</h2>
          </div>
          {canReviewSuppliers ? (
            <Link className="ops-pill" href="/suppliers">
              <UsersRound size={17} aria-hidden /> فتح الطابور
            </Link>
          ) : (
            <span className="ops-pill">عرض فقط</span>
          )}
        </div>
        <div className="ops-stack">
          <MetricLine label="معتمد" value={supplierCounts.approved} />
          <MetricLine label="تحت المراجعة" value={supplierCounts.underReview} />
          <MetricLine label="معلّق" value={supplierCounts.pending} />
        </div>
        <div className="mini-list">
          {pendingSuppliers.map((supplier) => (
            <div key={supplier.id}>
              <strong>{supplier.businessName}</strong>
              <small>
                {supplier.city ?? 'بدون مدينة'} ·{' '}
                {ar(SUPPLIER_STATUS_AR, supplier.status)} ·{' '}
                {timeAgo(supplier.createdAt)}
              </small>
            </div>
          ))}
          {pendingSuppliers.length === 0 ? (
            <p className="empty">لا توجد منشآت بانتظار المراجعة.</p>
          ) : null}
        </div>
      </article>

      <article className="ops-card span-4">
        <div className="ops-card-head">
          <div>
            <p>Commercial gate</p>
            <h2>الدفع والضمان</h2>
          </div>
          <WalletCards size={22} aria-hidden />
        </div>
        <div className="money-block">
          <strong>{money(escrowValue)} ر.س</strong>
          <span>مبالغ محتجزة حتى اكتمال التسليم</span>
        </div>
        <div className="ops-stack">
          <MetricLine label="بانتظار الدفع" value={paymentCount} />
          <MetricLine label="نزاعات مفتوحة" value={disputeCount} />
          <Link href="/compliance">
            <MetricLine label="مراجعة امتثال" value={complianceCount} />
          </Link>
        </div>
      </article>

      <article className="ops-card span-4" id="fulfillment">
        <div className="ops-card-head">
          <div>
            <p>Fulfillment</p>
            <h2>الشحن والتسليم</h2>
          </div>
          <Truck size={22} aria-hidden />
        </div>
        <div className="ops-stack">
          <MetricLine
            label="ملصق/انتظار"
            value={shipmentCounts.pending + shipmentCounts.labelCreated}
          />
          <MetricLine label="في الطريق" value={shipmentCounts.inTransit} />
          <MetricLine label="تم التسليم" value={shipmentCounts.delivered} />
        </div>
        <p className="ops-note">
          اللوحة تبرز حالات الشحن الناقصة حتى لا يبقى الطلب بعد الدفع بلا حركة
          واضحة.
        </p>
      </article>
    </>
  );
}

function MetricLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-line">
      <span>{label}</span>
      <strong>{value.toLocaleString('ar-SA')}</strong>
    </div>
  );
}
