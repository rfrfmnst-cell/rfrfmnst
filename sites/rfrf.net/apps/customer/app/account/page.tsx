import {
  DisputeStatus,
  OrderStatus,
  PaymentStatus,
  PaymentRefundStatus,
  prisma,
  RFQStatus,
} from '@rafraf/db';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionCustomerId } from '../../lib/session';
import { customerLoginRedirectPath } from '../../lib/customer-proxy-policy';
import {
  customerPaymentExperience,
  paymentLaunchStatus,
} from '../../lib/payments/payment-launch';
import { AccountHeader } from './account-header';
import {
  ACTIVE_ORDER_STATUSES,
  SHIPPING_ORDER_STATUSES,
} from './account-status';
import styles from './account-styles';
import {
  CustomerDashboard,
  type CustomerDashboardOrder,
  type CustomerDashboardRfq,
} from './customer-dashboard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'حسابي — رفرف',
  description: 'تابع عروضك وطلباتك ومدفوعاتك وشحناتك في رفرف.',
};

const ACTIVE_STATUS_FILTER = [...ACTIVE_ORDER_STATUSES] as OrderStatus[];
const SHIPPING_STATUS_FILTER = [...SHIPPING_ORDER_STATUSES] as OrderStatus[];

export default async function CustomerAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ dispute?: string | string[] }>;
}) {
  const resolvedSearchParams = await searchParams;
  const rawDispute = resolvedSearchParams.dispute;
  const disputeStatus = Array.isArray(rawDispute) ? rawDispute[0] : rawDispute;
  const customerId = await getSessionCustomerId();
  if (!customerId)
    redirect(customerLoginRedirectPath('/account', resolvedSearchParams));

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { user: { select: { email: true, isActive: true } } },
  });
  if (!customer || !customer.user.isActive)
    redirect(customerLoginRedirectPath('/account', resolvedSearchParams));

  const [
    orders,
    orderCount,
    rfqs,
    rfqCount,
    readyRfqs,
    activeOrderCount,
    shippingOrderCount,
    openDisputeCount,
    openRefundCount,
    defaultAddressCount,
    defaultVehicleCount,
  ] = await Promise.all([
    prisma.order.findMany({
      where: { customerId },
      include: {
        quote: {
          include: { rfqItem: { select: { freeTextAr: true } } },
        },
        payments: {
          orderBy: { updatedAt: 'desc' },
          take: 1,
          select: { provider: true, status: true },
        },
        _count: {
          select: {
            payments: {
              where: {
                provider: { not: 'MOCK' },
                status: {
                  in: [
                    PaymentStatus.PENDING,
                    PaymentStatus.AUTHORIZED,
                    PaymentStatus.CAPTURED,
                    PaymentStatus.HELD,
                    PaymentStatus.RELEASED,
                  ],
                },
              },
            },
          },
        },
        paymentRefunds: {
          orderBy: { updatedAt: 'desc' },
          take: 1,
          select: {
            status: true,
            amount: true,
            currency: true,
            payment: { select: { provider: true } },
          },
        },
        shipments: {
          orderBy: { updatedAt: 'desc' },
          take: 1,
          select: { provider: true, status: true, trackingNumber: true },
        },
        disputes: {
          orderBy: { updatedAt: 'desc' },
          take: 1,
          select: { status: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.order.count({ where: { customerId } }),
    prisma.rFQ.findMany({
      where: { customerId },
      include: { items: { take: 1, select: { freeTextAr: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.rFQ.count({ where: { customerId } }),
    prisma.rFQ.findMany({
      where: {
        customerId,
        status: { in: [RFQStatus.QUOTES_READY, RFQStatus.CUSTOMER_SELECTED] },
      },
      include: { items: { take: 1, select: { freeTextAr: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 4,
    }),
    prisma.order.count({
      where: { customerId, status: { in: ACTIVE_STATUS_FILTER } },
    }),
    prisma.order.count({
      where: { customerId, status: { in: SHIPPING_STATUS_FILTER } },
    }),
    prisma.dispute.count({
      where: {
        customerId,
        status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] },
      },
    }),
    prisma.paymentRefund.count({
      where: {
        order: { customerId },
        status: {
          in: [
            PaymentRefundStatus.REQUESTED,
            PaymentRefundStatus.PROCESSING,
            PaymentRefundStatus.PROVIDER_PENDING,
            PaymentRefundStatus.FAILED_RETRYABLE,
          ],
        },
      },
    }),
    prisma.customerAddress.count({ where: { customerId, isDefault: true } }),
    prisma.customerVehicle.count({ where: { customerId, isDefault: true } }),
  ]);

  const dashboardOrders: CustomerDashboardOrder[] = orders.map((order) => ({
    id: order.id,
    code: order.code,
    status: order.status,
    totalAmount: Number(order.totalAmount),
    currency: order.currency,
    createdAt: order.createdAt,
    customerConfirmedAt: order.customerConfirmedAt,
    partText: order.quote?.rfqItem?.freeTextAr ?? null,
    payment: order.payments[0] ?? null,
    activePayment: order._count.payments > 0,
    refund: order.paymentRefunds[0]
      ? {
          provider: order.paymentRefunds[0].payment.provider,
          status: order.paymentRefunds[0].status,
          amount: Number(order.paymentRefunds[0].amount),
          currency: order.paymentRefunds[0].currency,
        }
      : null,
    shipment: order.shipments[0] ?? null,
    dispute: order.disputes[0] ?? null,
  }));

  const mapRfq = (rfq: (typeof rfqs)[number]): CustomerDashboardRfq => ({
    id: rfq.id,
    code: rfq.code,
    status: rfq.status,
    createdAt: rfq.createdAt,
    partText: rfq.items[0]?.freeTextAr ?? null,
  });

  return (
    <>
      <AccountHeader active="dashboard" customerName={customer.fullName} />
      <main className={`container ${styles.main} rafraf-page-enter`}>
        <CustomerDashboard
          customerName={customer.fullName}
          orders={dashboardOrders}
          orderCount={orderCount}
          rfqs={rfqs.map(mapRfq)}
          rfqCount={rfqCount}
          readyOffers={readyRfqs.map(mapRfq)}
          activeOrderCount={activeOrderCount}
          shippingOrderCount={shippingOrderCount}
          openSupportCount={openDisputeCount + openRefundCount}
          disputeStatus={disputeStatus}
          profileReadiness={{
            hasEmail: Boolean(customer.user.email?.trim()),
            hasDefaultAddress: defaultAddressCount > 0,
            hasDefaultVehicle: defaultVehicleCount > 0,
          }}
          paymentExperience={customerPaymentExperience(
            paymentLaunchStatus(process.env),
          )}
        />
      </main>
    </>
  );
}
