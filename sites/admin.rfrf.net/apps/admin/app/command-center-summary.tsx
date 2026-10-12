import {
  AlertTriangle,
  ArrowUpLeft,
  Banknote,
  Bot,
  ClipboardCheck,
  CreditCard,
  PackageSearch,
  Truck,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import Link from 'next/link';
import type { ComponentType } from 'react';
import { money, pct } from './command-center-format';

interface PipelineValues {
  aiIntake: number;
  sourcing: number;
  quoteReview: number;
  payment: number;
  fulfillment: number;
}

interface CommandCenterSummaryProps {
  aiConfidence: number;
  escrowValue: number;
  pipelineValues: PipelineValues;
  reviewCount: number;
  canReviewSuppliers: boolean;
  pendingSuppliersCount: number;
  alertCount: number;
  revenueValue: number;
  aiDecisionCount: number;
  approvedSupplierCount: number;
  supplierReviewCount: number;
  paymentCount: number;
}

export function CommandCenterSummary({
  aiConfidence,
  escrowValue,
  pipelineValues,
  reviewCount,
  canReviewSuppliers,
  pendingSuppliersCount,
  alertCount,
  revenueValue,
  aiDecisionCount,
  approvedSupplierCount,
  supplierReviewCount,
  paymentCount,
}: CommandCenterSummaryProps) {
  const pipeline = [
    {
      label: 'AI intake',
      value: pipelineValues.aiIntake,
      icon: Bot,
      note: 'فرز وفهم وتوافق',
    },
    {
      label: 'Sourcing',
      value: pipelineValues.sourcing,
      icon: PackageSearch,
      note: 'محلي ودولي',
    },
    {
      label: 'Quote review',
      value: pipelineValues.quoteReview,
      icon: ClipboardCheck,
      note: 'تسعير واعتماد',
    },
    {
      label: 'Payment',
      value: pipelineValues.payment,
      icon: CreditCard,
      note: 'بانتظار التحصيل',
    },
    {
      label: 'Fulfillment',
      value: pipelineValues.fulfillment,
      icon: Truck,
      note: 'شحن وتسليم',
    },
  ];

  return (
    <>
      <header className="ops-topbar">
        <div>
          <p className="ops-kicker">
            <span /> Rafraf operations OS
          </p>
          <h1>لوحة تشغيل رفرف</h1>
          <p>
            مراقبة الطلب من فهم AI حتى الدفع والشحن، بنفس لغة رفرف الرسمية وخط
            ثمانية.
          </p>
        </div>
        <nav className="ops-top-actions" aria-label="اختصارات التشغيل">
          <Link href="/catalog">فتح الكتالوج</Link>
          <Link href="/integrations">حالة التكاملات</Link>
        </nav>
      </header>

      <section className="ops-hero" aria-label="ملخص التشغيل">
        <div className="ops-hero-copy">
          <p>القلب التشغيلي</p>
          <h2>AI يفرز، الفريق يعتمد، والعميل يرى عرضاً آمناً فقط.</h2>
          <div className="ops-hero-meta">
            <span>
              <Bot size={16} aria-hidden /> ثقة AI {pct(aiConfidence)}
            </span>
            <span>
              <WalletCards size={16} aria-hidden /> محتجز {money(escrowValue)}{' '}
              ر.س
            </span>
          </div>
        </div>
        <div className="ops-flow" aria-label="مسار التشغيل">
          {pipeline.map((step, index) => {
            const Icon = step.icon;
            return (
              <article key={step.label}>
                <small>{String(index + 1).padStart(2, '0')}</small>
                <Icon size={20} aria-hidden />
                <strong>{step.value}</strong>
                <span>{step.label}</span>
                <p>{step.note}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="ops-priority-rail" aria-label="أولويات فريق العمليات">
        <div className="ops-priority-heading">
          <p>قرار اليوم</p>
          <h2>حوّل التنبيه إلى خطوة تشغيل واضحة.</h2>
        </div>
        <a href="#requests">
          <ClipboardCheck size={18} aria-hidden />
          <span>
            <strong>{reviewCount} حالات</strong>
            <small>تحتاج مراجعة توافق أو بيانات</small>
          </span>
          <ArrowUpLeft size={16} aria-hidden />
        </a>
        {canReviewSuppliers ? (
          <Link href="/suppliers">
            <UsersRound size={18} aria-hidden />
            <span>
              <strong>{pendingSuppliersCount} موردين</strong>
              <small>بانتظار قرار الاعتماد</small>
            </span>
            <ArrowUpLeft size={16} aria-hidden />
          </Link>
        ) : (
          <div className="ops-priority-disabled">
            <UsersRound size={18} aria-hidden />
            <span>
              <strong>{pendingSuppliersCount} موردين</strong>
              <small>العرض فقط؛ الاعتماد يحتاج SUPPLIER_WRITE</small>
            </span>
          </div>
        )}
        <a href="#fulfillment">
          <AlertTriangle size={18} aria-hidden />
          <span>
            <strong>{alertCount} تنبيهات</strong>
            <small>نزاعات أو امتثال مفتوح</small>
          </span>
          <ArrowUpLeft size={16} aria-hidden />
        </a>
      </section>

      <section className="ops-kpi-grid" aria-label="مؤشرات رئيسية">
        <KpiCard
          icon={Banknote}
          label="قيمة الطلبات"
          value={`${money(revenueValue)} ر.س`}
          trend="إجمالي أوامر الشراء"
        />
        <KpiCard
          icon={Bot}
          label="قرارات AI"
          value={aiDecisionCount.toLocaleString('ar-SA')}
          trend={`متوسط الثقة ${pct(aiConfidence)}`}
        />
        <KpiCard
          icon={AlertTriangle}
          label="مراجعة بشرية"
          value={reviewCount.toLocaleString('ar-SA')}
          trend="توافق أو حساسية عالية"
        />
        <KpiCard
          icon={UsersRound}
          label="موردون معتمدون"
          value={approvedSupplierCount.toLocaleString('ar-SA')}
          trend={`${supplierReviewCount} بانتظار المراجعة`}
        />
        <KpiCard
          icon={CreditCard}
          label="بانتظار الدفع"
          value={paymentCount.toLocaleString('ar-SA')}
          trend="جاهزة للتحصيل"
        />
      </section>
    </>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  trend,
}: {
  icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
  label: string;
  value: string;
  trend: string;
}) {
  return (
    <article className="ops-kpi">
      <span>
        <Icon size={19} aria-hidden />
      </span>
      <small>{label}</small>
      <strong>{value}</strong>
      <em>
        <ArrowUpLeft size={14} aria-hidden /> {trend}
      </em>
    </article>
  );
}
