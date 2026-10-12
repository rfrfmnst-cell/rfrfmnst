import type { Metadata } from 'next';
import {
  Headphones,
  Home,
  PackageSearch,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { BrandLogo } from '@rafraf/ui/brand-logo';
import { TrackForm } from './track-form';
import {
  customerPaymentExperience,
  paymentLaunchStatus,
} from '../../lib/payments/payment-launch';

export const metadata: Metadata = {
  title: 'تتبع طلبك — رفرف',
  description:
    'سجّل الدخول وتابع حالة طلب قطعتك في رفرف — من الاستلام حتى التسليم.',
};

const RFQ_CODE_PATTERN = /^RFQ-\d{4}-\d{5}$/;
const ORDER_CODE_PATTERN = /^ORD-[A-Z0-9-]{3,32}$/;

function safeCode(value: string | undefined): string {
  const code = value?.trim().toUpperCase() ?? '';
  return RFQ_CODE_PATTERN.test(code) || ORDER_CODE_PATTERN.test(code)
    ? code
    : '';
}

export default async function TrackPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; paymentReturn?: string }>;
}) {
  const { code, paymentReturn } = await searchParams;
  const paymentExperience = customerPaymentExperience(
    paymentLaunchStatus(process.env),
  );

  return (
    <>
      <header className="site-header track-header">
        <div className="container row">
          <Link href="/" className="header-brand" aria-label="رفرف - الرئيسية">
            <BrandLogo />
          </Link>
          <nav aria-label="التنقل">
            <Link href="/">
              <Home size={16} aria-hidden />
              <span>الرئيسية</span>
            </Link>
            <Link className="cta-link" href="/chat">
              <Sparkles size={16} aria-hidden />
              <span>ابدأ مع رفرف AI</span>
            </Link>
          </nav>
        </div>
      </header>

      <main className="track-wrap">
        <section className="container track-intro">
          <p className="track-eyebrow">
            <PackageSearch size={18} aria-hidden /> مركز متابعة الطلبات
          </p>
          <h1 className="track-title">قطعتك تحت المتابعة، خطوة بخطوة</h1>
          <p className="track-sub">
            سجّل الدخول وأدخل رقم الطلب. نعرض حالة المطابقة والعروض والشحن
            للطلبات المرتبطة بحسابك فقط، دون كشف تفاصيل الموردين.
          </p>
        </section>

        <div className="container track-layout">
          <TrackForm
            initialCode={safeCode(code)}
            paymentReturn={
              paymentExperience.kind === 'checkout' && paymentReturn === '1'
            }
          />
          <aside className="track-assurance" aria-label="ضمانات متابعة رفرف">
            <div>
              <ShieldCheck size={20} aria-hidden />
              <span>
                <strong>خصوصية الطلب</strong>
                لا تظهر الحالة إلا لصاحب الحساب الموثق.
              </span>
            </div>
            <div>
              <PackageSearch size={20} aria-hidden />
              <span>
                <strong>حالة موحّدة</strong>
                من التحقق من القطعة حتى التسليم.
              </span>
            </div>
            <div>
              <Headphones size={20} aria-hidden />
              <span>
                <strong>مراجعة بشرية</strong>
                للقطع الحساسة أو المطابقة المنخفضة.
              </span>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
