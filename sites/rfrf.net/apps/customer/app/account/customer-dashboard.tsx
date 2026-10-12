import {
  ArrowLeft,
  Car,
  CheckCircle2,
  Clock3,
  Headphones,
  MapPin,
  MessageCircle,
  PackageCheck,
  PackageSearch,
  ShieldCheck,
  Sparkles,
  Truck,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { customerSettingsSectionPath } from './account-navigation';
import {
  RFQ_STATUSES_WITH_VISIBLE_OFFERS,
  RFQ_STATUS_AR,
} from './account-status';
import styles from './account-styles';
import {
  CUSTOMER_ACCOUNT_DATE,
  type CustomerDashboardProps,
  type CustomerDashboardOrder,
  type CustomerDashboardRfq,
  customerFirstName,
  customerStatusTone,
} from './customer-dashboard-model';
import { CustomerDashboardNextAction } from './customer-dashboard-next-action';
import { CustomerDashboardOrderCard } from './customer-dashboard-order-card';
import { customerProfileSetupPending } from './customer-dashboard-state';
import dashboardStyles from './customer-dashboard-styles';
import disputeStyles from './dispute.module.css';

export type { CustomerDashboardOrder, CustomerDashboardRfq };

export function CustomerDashboard({
  customerName,
  orders,
  orderCount,
  rfqs,
  rfqCount,
  readyOffers,
  activeOrderCount,
  shippingOrderCount,
  openSupportCount,
  profileReadiness,
  paymentExperience,
  disputeStatus,
}: CustomerDashboardProps) {
  const readinessItems = [
    {
      label: 'البريد الإلكتروني',
      complete: profileReadiness.hasEmail,
      href: customerSettingsSectionPath('profile'),
    },
    {
      label: 'عنوان الشحن الافتراضي',
      complete: profileReadiness.hasDefaultAddress,
      href: customerSettingsSectionPath('addresses-title'),
    },
    {
      label: 'المركبة الافتراضية',
      complete: profileReadiness.hasDefaultVehicle,
      href: customerSettingsSectionPath('vehicles-title'),
    },
  ];
  const readinessCount = readinessItems.filter((item) => item.complete).length;

  return (
    <>
      <div className={dashboardStyles.welcomeRow}>
        <div>
          <p className={styles.kicker}>RAFRAF CUSTOMER PORTAL</p>
          <h1>مرحباً، {customerFirstName(customerName)}</h1>
          <p>طلباتك وعروضك ومدفوعاتك وشحناتك في مساحة واحدة آمنة.</p>
        </div>
        <Link className={dashboardStyles.newRequest} href="/chat">
          <MessageCircle size={18} aria-hidden /> طلب قطعة جديدة
        </Link>
      </div>

      <CustomerDashboardNextAction
        readyOffers={readyOffers}
        orders={orders}
        paymentExperience={paymentExperience}
        profileSetupPending={customerProfileSetupPending(profileReadiness)}
      />

      <dl className={dashboardStyles.metrics} aria-label="ملخص حساب العميل">
        <a href="#ready-offers">
          <dt>
            <Sparkles size={18} aria-hidden /> عروض تنتظر قرارك
          </dt>
          <dd>{readyOffers.length.toLocaleString('ar-SA')}</dd>
        </a>
        <a href="#orders">
          <dt>
            <PackageCheck size={18} aria-hidden /> طلبات نشطة
          </dt>
          <dd>{activeOrderCount.toLocaleString('ar-SA')}</dd>
        </a>
        <a href="#orders">
          <dt>
            <Truck size={18} aria-hidden /> قيد الشحن
          </dt>
          <dd>{shippingOrderCount.toLocaleString('ar-SA')}</dd>
        </a>
        <a href="#orders">
          <dt>
            <Headphones size={18} aria-hidden /> دعم أو استرداد
          </dt>
          <dd>{openSupportCount.toLocaleString('ar-SA')}</dd>
        </a>
      </dl>

      <div className={dashboardStyles.dashboardGrid}>
        <div className={dashboardStyles.dashboardContent}>
          <ReadyOffers readyOffers={readyOffers} />
          <Orders
            orders={orders}
            orderCount={orderCount}
            disputeStatus={disputeStatus}
            paymentExperience={paymentExperience}
          />
          <Rfqs rfqs={rfqs} rfqCount={rfqCount} />
        </div>
        <DashboardSidebar
          readinessItems={readinessItems}
          readinessCount={readinessCount}
        />
      </div>
    </>
  );
}

function ReadyOffers({ readyOffers }: { readyOffers: CustomerDashboardRfq[] }) {
  return (
    <section
      id="ready-offers"
      className={styles.panel}
      aria-labelledby="ready-offers-title"
    >
      <header className={styles.panelHeader}>
        <Sparkles size={21} aria-hidden />
        <div>
          <h2 id="ready-offers-title">عروض جاهزة</h2>
          <p className={styles.panelHint}>
            قارن السعر النهائي والمدة والضمان قبل الاعتماد.
          </p>
        </div>
      </header>
      {readyOffers.length === 0 ? (
        <div className={dashboardStyles.emptyState}>
          <CheckCircle2 size={28} aria-hidden />
          <strong>لا توجد عروض بانتظار قرارك</strong>
          <span>سنظهر العرض هنا فور اكتمال المراجعة والتسعير.</span>
        </div>
      ) : (
        <div className={dashboardStyles.offerGrid}>
          {readyOffers.map((rfq) => (
            <article key={rfq.id} className={dashboardStyles.offerCard}>
              <span className={dashboardStyles.statusBadge} data-tone="success">
                جاهز للمقارنة
              </span>
              <h3>{rfq.partText ?? 'طلب تسعير'}</h3>
              <p>
                <bdi dir="ltr">{rfq.code}</bdi> ·{' '}
                {CUSTOMER_ACCOUNT_DATE.format(rfq.createdAt)}
              </p>
              <Link href={`/track?code=${encodeURIComponent(rfq.code)}`}>
                مشاهدة العروض <ArrowLeft size={15} aria-hidden />
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function Orders({
  orders,
  orderCount,
  disputeStatus,
  paymentExperience,
}: {
  orders: CustomerDashboardOrder[];
  orderCount: number;
  disputeStatus?: string;
  paymentExperience: CustomerDashboardProps['paymentExperience'];
}) {
  return (
    <section
      id="orders"
      className={styles.panel}
      aria-labelledby="orders-title"
    >
      <header className={styles.panelHeader}>
        <PackageCheck size={21} aria-hidden />
        <div>
          <h2 id="orders-title">
            طلباتي ({orderCount.toLocaleString('ar-SA')})
          </h2>
          <p className={styles.panelHint}>حالة الدفع والشحن والدعم لكل طلب.</p>
        </div>
      </header>
      {disputeStatus ? (
        <p
          className={`${disputeStyles.orderNotice} ${
            disputeStatus === 'opened'
              ? disputeStyles.orderNoticeSuccess
              : disputeStyles.orderNoticeError
          }`}
          role={disputeStatus === 'opened' ? 'status' : 'alert'}
        >
          {disputeStatus === 'opened'
            ? 'تم فتح الشكوى وإيقاف التسوية حتى تراجعها العمليات.'
            : disputeStatus === 'invalid'
              ? 'تعذّر فتح الشكوى. تأكد من السبب واكتب وصفاً واضحاً.'
              : 'تعذّر حفظ الشكوى الآن. حاول مرة أخرى.'}
        </p>
      ) : null}
      {orders.length === 0 ? (
        <div className={dashboardStyles.emptyState}>
          <PackageSearch size={28} aria-hidden />
          <strong>لا توجد طلبات شراء بعد</strong>
          <span>ابدأ بطلب قطعة، ثم قارن العروض واعتمد الأنسب لك.</span>
          <Link href="/chat">ابدأ طلبك الأول</Link>
        </div>
      ) : (
        <div className={dashboardStyles.orderList}>
          {orders.map((order) => (
            <CustomerDashboardOrderCard
              key={order.id}
              order={order}
              paymentExperience={paymentExperience}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function Rfqs({
  rfqs,
  rfqCount,
}: {
  rfqs: CustomerDashboardRfq[];
  rfqCount: number;
}) {
  return (
    <section id="rfqs" className={styles.panel} aria-labelledby="rfqs-title">
      <header className={styles.panelHeader}>
        <PackageSearch size={21} aria-hidden />
        <div>
          <h2 id="rfqs-title">
            طلبات التسعير ({rfqCount.toLocaleString('ar-SA')})
          </h2>
          <p className={styles.panelHint}>من استلام الطلب حتى اعتماد العرض.</p>
        </div>
      </header>
      {rfqs.length === 0 ? (
        <div className={dashboardStyles.emptyState}>
          <PackageSearch size={28} aria-hidden />
          <strong>لا توجد طلبات تسعير حالية</strong>
          <Link href="/chat">اطلب قطعة جديدة</Link>
        </div>
      ) : (
        <div className={dashboardStyles.rfqList}>
          {rfqs.map((rfq) => (
            <RfqRow key={rfq.id} rfq={rfq} />
          ))}
        </div>
      )}
    </section>
  );
}

function RfqRow({ rfq }: { rfq: CustomerDashboardRfq }) {
  const showsOffers = RFQ_STATUSES_WITH_VISIBLE_OFFERS.has(rfq.status);
  return (
    <article>
      <span className={dashboardStyles.rfqIcon}>
        <PackageSearch size={18} aria-hidden />
      </span>
      <div>
        <h3>{rfq.partText ?? 'طلب تسعير'}</h3>
        <p>
          <bdi dir="ltr">{rfq.code}</bdi> ·{' '}
          {CUSTOMER_ACCOUNT_DATE.format(rfq.createdAt)}
        </p>
      </div>
      <span
        className={dashboardStyles.statusBadge}
        data-tone={customerStatusTone(rfq.status)}
      >
        {RFQ_STATUS_AR[rfq.status] ?? 'جاري البحث'}
      </span>
      {showsOffers ? (
        <Link href={`/track?code=${encodeURIComponent(rfq.code)}`}>
          شاهد العروض <ArrowLeft size={14} aria-hidden />
        </Link>
      ) : null}
    </article>
  );
}

function DashboardSidebar({
  readinessItems,
  readinessCount,
}: {
  readinessItems: { label: string; complete: boolean; href: string }[];
  readinessCount: number;
}) {
  return (
    <aside
      className={dashboardStyles.sidebar}
      aria-label="التنقل ومعلومات الحساب"
    >
      <nav className={dashboardStyles.accountNav} aria-label="أقسام الحساب">
        <strong>حسابي</strong>
        <a href="#ready-offers">
          <Sparkles size={17} aria-hidden /> العروض الجاهزة
        </a>
        <a href="#orders">
          <PackageCheck size={17} aria-hidden /> الطلبات والمدفوعات
        </a>
        <a href="#rfqs">
          <PackageSearch size={17} aria-hidden /> طلبات التسعير
        </a>
        <Link href={customerSettingsSectionPath('profile')}>
          <UserRound size={17} aria-hidden /> البيانات الشخصية
        </Link>
        <Link href={customerSettingsSectionPath('addresses-title')}>
          <MapPin size={17} aria-hidden /> عناوين الشحن
        </Link>
        <Link href={customerSettingsSectionPath('vehicles-title')}>
          <Car size={17} aria-hidden /> المركبات
        </Link>
      </nav>
      <section
        className={dashboardStyles.readiness}
        aria-labelledby="readiness-title"
      >
        <header>
          <div>
            <p>جاهزية الحساب</p>
            <h2 id="readiness-title">{readinessCount} من 3 مكتملة</h2>
          </div>
          <span>
            {Math.round((readinessCount / readinessItems.length) * 100)}٪
          </span>
        </header>
        <progress value={readinessCount} max={readinessItems.length}>
          {readinessCount} من {readinessItems.length}
        </progress>
        <ul>
          {readinessItems.map((item) => (
            <li key={item.label} data-complete={item.complete}>
              {item.complete ? (
                <CheckCircle2 size={16} aria-hidden />
              ) : (
                <Clock3 size={16} aria-hidden />
              )}
              <Link href={item.href}>{item.label}</Link>
            </li>
          ))}
        </ul>
      </section>
      <section className={dashboardStyles.help} aria-labelledby="help-title">
        <Headphones size={22} aria-hidden />
        <div>
          <h2 id="help-title">تحتاج مساعدة؟</h2>
          <p>راجع طلبك مع مساعد رفرف دون مشاركة بياناتك مع المورد.</p>
          <Link href="/chat">
            فتح المحادثة <ArrowLeft size={14} aria-hidden />
          </Link>
        </div>
      </section>
      <section
        className={dashboardStyles.privacy}
        aria-labelledby="privacy-title"
      >
        <ShieldCheck size={20} aria-hidden />
        <div>
          <h2 id="privacy-title">خصوصيتك محفوظة</h2>
          <p>
            لا نعرض تكلفة المورد أو هامش رفرف، ولا نشارك بياناتك الشخصية معه.
          </p>
        </div>
      </section>
    </aside>
  );
}
