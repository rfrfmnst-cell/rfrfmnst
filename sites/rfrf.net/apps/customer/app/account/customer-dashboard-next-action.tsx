import {
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  PackageCheck,
  Sparkles,
  Truck,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { ACTIVE_ORDER_STATUSES, ORDER_STATUS_AR } from './account-status';
import type {
  CustomerDashboardProps,
  CustomerDashboardOrder,
  CustomerDashboardRfq,
} from './customer-dashboard-model';
import dashboardStyles from './customer-dashboard-styles';

export function CustomerDashboardNextAction({
  readyOffers,
  orders,
  paymentExperience,
  profileSetupPending,
}: {
  readyOffers: CustomerDashboardRfq[];
  orders: CustomerDashboardOrder[];
  paymentExperience: CustomerDashboardProps['paymentExperience'];
  profileSetupPending: boolean;
}) {
  const readyOffer = readyOffers[0];
  if (readyOffer) {
    return (
      <section
        className={dashboardStyles.nextAction}
        aria-labelledby="next-action-title"
      >
        <span className={dashboardStyles.nextActionIcon}>
          <Sparkles size={24} aria-hidden />
        </span>
        <div className={dashboardStyles.nextActionBody}>
          <p>بانتظار قرارك</p>
          <h2 id="next-action-title">عرض سعر جاهز للمقارنة</h2>
          <span>
            {readyOffer.partText ?? 'طلب تسعير'} ·{' '}
            <bdi dir="ltr">{readyOffer.code}</bdi>
          </span>
        </div>
        <Link href={`/track?code=${encodeURIComponent(readyOffer.code)}`}>
          مقارنة العروض <ArrowLeft size={17} aria-hidden />
        </Link>
      </section>
    );
  }

  const paymentOrder = orders.find(
    (order) => order.status === 'AWAITING_PAYMENT',
  );
  if (paymentOrder) {
    return (
      <section
        className={dashboardStyles.nextAction}
        aria-labelledby="next-action-title"
      >
        <span className={dashboardStyles.nextActionIcon}>
          <CreditCard size={24} aria-hidden />
        </span>
        <div className={dashboardStyles.nextActionBody}>
          <p>خطوة مطلوبة</p>
          <h2 id="next-action-title">{paymentExperience.nextActionTitle}</h2>
          <span>
            {paymentOrder.partText ?? 'قطعة غيار'} ·{' '}
            <bdi dir="ltr">{paymentOrder.code}</bdi>
          </span>
        </div>
        <Link href={`/track?code=${encodeURIComponent(paymentOrder.code)}`}>
          {paymentExperience.nextActionLinkLabel}{' '}
          <ArrowLeft size={17} aria-hidden />
        </Link>
      </section>
    );
  }

  const receiptOrder = orders.find(
    (order) =>
      order.status === 'COMPLAINT_WINDOW' && !order.customerConfirmedAt,
  );
  if (receiptOrder) {
    return (
      <section
        className={dashboardStyles.nextAction}
        aria-labelledby="next-action-title"
      >
        <span className={dashboardStyles.nextActionIcon}>
          <PackageCheck size={24} aria-hidden />
        </span>
        <div className={dashboardStyles.nextActionBody}>
          <p>تأكيد الاستلام</p>
          <h2 id="next-action-title">وصلت القطعة؟ راجعها وأكد الاستلام</h2>
          <span>
            {receiptOrder.partText ?? 'قطعة غيار'} ·{' '}
            <bdi dir="ltr">{receiptOrder.code}</bdi>
          </span>
        </div>
        <a href="#orders">
          مراجعة الطلب <ArrowLeft size={17} aria-hidden />
        </a>
      </section>
    );
  }

  const activeOrder = orders.find((order) =>
    ACTIVE_ORDER_STATUSES.has(order.status),
  );
  if (activeOrder) {
    return (
      <section
        className={dashboardStyles.nextAction}
        aria-labelledby="next-action-title"
      >
        <span className={dashboardStyles.nextActionIcon}>
          <Truck size={24} aria-hidden />
        </span>
        <div className={dashboardStyles.nextActionBody}>
          <p>آخر تحديث</p>
          <h2 id="next-action-title">{ORDER_STATUS_AR[activeOrder.status]}</h2>
          <span>
            {activeOrder.partText ?? 'قطعة غيار'} ·{' '}
            <bdi dir="ltr">{activeOrder.code}</bdi>
          </span>
        </div>
        <Link href={`/track?code=${encodeURIComponent(activeOrder.code)}`}>
          تتبع الطلب <ArrowLeft size={17} aria-hidden />
        </Link>
      </section>
    );
  }

  if (profileSetupPending) {
    return (
      <section
        className={dashboardStyles.nextAction}
        aria-labelledby="next-action-title"
      >
        <span className={dashboardStyles.nextActionIcon}>
          <UserRound size={24} aria-hidden />
        </span>
        <div className={dashboardStyles.nextActionBody}>
          <p>إعداد الحساب</p>
          <h2 id="next-action-title">أكمل بياناتك قبل طلب القطعة</h2>
          <span>
            أضف البريد وعنوان الشحن والمركبة لتسريع المطابقة والتسليم.
          </span>
        </div>
        <Link href="/account/settings">
          إكمال الإعداد <ArrowLeft size={17} aria-hidden />
        </Link>
      </section>
    );
  }

  return (
    <section
      className={dashboardStyles.nextAction}
      aria-labelledby="next-action-title"
    >
      <span className={dashboardStyles.nextActionIcon}>
        <CheckCircle2 size={24} aria-hidden />
      </span>
      <div className={dashboardStyles.nextActionBody}>
        <p>لا توجد خطوات معلّقة</p>
        <h2 id="next-action-title">كل شيء على المسار</h2>
        <span>يمكنك بدء طلب قطعة جديد عندما تكون جاهزاً.</span>
      </div>
      <Link href="/chat">
        طلب قطعة جديدة <ArrowLeft size={17} aria-hidden />
      </Link>
    </section>
  );
}
