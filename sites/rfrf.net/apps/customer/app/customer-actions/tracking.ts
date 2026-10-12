import { OrderStatus, prisma, RFQStatus } from '@rafraf/db';
import { ACTIVE_PAYMENT_INTAKE_STATUSES } from '@rafraf/shared/payments/payment-intake';
import { isOrderPayable } from '@rafraf/shared/payments/payment-state';
import { normalizeCustomerEmail } from '../../lib/customer-profile';
import { formatCustomerOrderTotal } from '../../lib/customer-order';
import {
  customerPaymentExperience,
  paymentLaunchStatus,
  type CustomerPaymentExperience,
} from '../../lib/payments/payment-launch';
import {
  formatTrackingDateTime,
  ORDER_STATUS_AR,
  RFQ_STATUS_AR,
  shipmentTimelineEntry,
} from '../../lib/customer-tracking-status';
import { getSessionCustomerId } from '../../lib/session';

/* ─── التتبع العام للعميل (Rule 2 آمنة) ──────────────────────────────
 * جلسة cu_auth الموقعة + رقم الطلب (RFQ-… أو ORD-…). لا يُكشف وجود الكود
 * إن لم يكن مملوكاً للعميل الموثق. يُعاد: حالة عربية + خط زمني مبسط +
 * السعر النهائي إن وُجد أمر — لا مورد، لا تكلفة، لا هامش، ولا ملاحظات داخلية. */

export interface TrackTimelineEntry {
  label: string;
  date: string;
}

export interface TrackPaymentAction {
  orderId: string;
  orderCode: string;
  emailRequired: boolean;
  processing: boolean;
  kind: CustomerPaymentExperience['kind'];
}

export interface TrackState {
  error?: string;
  authRequired?: boolean;
  values?: Record<string, string>;
  result?: {
    code: string;
    statusAr: string;
    partText: string | null;
    createdAt: string;
    timeline: TrackTimelineEntry[];
    finalPrice: string | null;
    payment: TrackPaymentAction | null;
  };
}

const TRACK_NO_MATCH = 'لا يوجد طلب مطابق.';

function customerPaymentAction(
  order: {
    id: string;
    code: string;
    status: OrderStatus;
    customer: { user: { email: string | null } };
    payments: Array<{ id: string }>;
  } | null,
  experience: CustomerPaymentExperience,
): TrackPaymentAction | null {
  if (!order || !isOrderPayable(order.status)) return null;
  return {
    orderId: order.id,
    orderCode: order.code,
    emailRequired: !normalizeCustomerEmail(order.customer.user.email),
    processing: order.payments.length > 0,
    kind: experience.kind,
  };
}

export async function trackRequestUseCase(
  _prev: TrackState,
  formData: FormData,
): Promise<TrackState> {
  const values = {
    code: String(formData.get('code') ?? '')
      .trim()
      .toUpperCase(),
  };
  const paymentExperience = customerPaymentExperience(
    paymentLaunchStatus(process.env),
  );
  try {
    const customerId = await getSessionCustomerId();
    if (!customerId)
      return {
        authRequired: true,
        error: 'سجّل الدخول أولاً لتتبع طلبات حسابك بأمان.',
        values,
      };

    if (!values.code) return { error: 'أدخل رقم الطلب.', values };

    if (values.code.startsWith('RFQ-')) {
      const rfq = await prisma.rFQ.findFirst({
        where: { code: values.code, customerId },
        include: {
          items: true,
          orders: {
            orderBy: { createdAt: 'desc' },
            include: {
              customer: {
                select: { user: { select: { email: true } } },
              },
              payments: {
                where: {
                  provider: { not: 'MOCK' },
                  status: { in: [...ACTIVE_PAYMENT_INTAKE_STATUSES] },
                },
                select: { id: true },
                take: 1,
              },
              events: { orderBy: { createdAt: 'asc' } },
              shipments: { orderBy: { updatedAt: 'asc' } },
            },
          },
        },
      });
      // رسالة واحدة لعدم الوجود أو اختلاف المالك — لا تعداد للأكواد.
      if (!rfq) return { error: TRACK_NO_MATCH, values };

      const order = rfq.orders[0] ?? null;
      const timeline: TrackTimelineEntry[] = [
        { label: 'استلام الطلب', date: formatTrackingDateTime(rfq.createdAt) },
      ];
      if (rfq.status !== RFQStatus.DRAFT)
        timeline.push({
          label: RFQ_STATUS_AR[rfq.status],
          date: formatTrackingDateTime(rfq.updatedAt),
        });
      if (order) {
        timeline.push({
          label: `أمر الشراء ${order.code}`,
          date: formatTrackingDateTime(order.createdAt),
        });
        for (const ev of order.events)
          timeline.push({
            label: ORDER_STATUS_AR[ev.toStatus],
            date: formatTrackingDateTime(ev.createdAt),
          });
        for (const shipment of order.shipments) {
          const entry = shipmentTimelineEntry(shipment);
          if (entry) timeline.push(entry);
        }
      }
      return {
        result: {
          code: rfq.code,
          statusAr: order
            ? ORDER_STATUS_AR[order.status]
            : RFQ_STATUS_AR[rfq.status],
          partText: rfq.items[0]?.freeTextAr ?? null,
          createdAt: formatTrackingDateTime(rfq.createdAt),
          timeline,
          finalPrice: order
            ? formatCustomerOrderTotal(order.totalAmount, order.currency)
            : null,
          payment: customerPaymentAction(order, paymentExperience),
        },
      };
    }

    if (values.code.startsWith('ORD-')) {
      const order = await prisma.order.findFirst({
        where: { code: values.code, customerId },
        include: {
          rfq: true,
          quote: { include: { rfqItem: true } },
          customer: {
            select: { user: { select: { email: true } } },
          },
          payments: {
            where: {
              provider: { not: 'MOCK' },
              status: { in: [...ACTIVE_PAYMENT_INTAKE_STATUSES] },
            },
            select: { id: true },
            take: 1,
          },
          events: { orderBy: { createdAt: 'asc' } },
          shipments: { orderBy: { updatedAt: 'asc' } },
        },
      });
      if (!order) return { error: TRACK_NO_MATCH, values };

      const timeline: TrackTimelineEntry[] = [];
      if (order.rfq)
        timeline.push({
          label: 'استلام الطلب',
          date: formatTrackingDateTime(order.rfq.createdAt),
        });
      timeline.push({
        label: `أمر الشراء ${order.code}`,
        date: formatTrackingDateTime(order.createdAt),
      });
      for (const ev of order.events)
        timeline.push({
          label: ORDER_STATUS_AR[ev.toStatus],
          date: formatTrackingDateTime(ev.createdAt),
        });
      for (const shipment of order.shipments) {
        const entry = shipmentTimelineEntry(shipment);
        if (entry) timeline.push(entry);
      }
      return {
        result: {
          code: order.code,
          statusAr: ORDER_STATUS_AR[order.status],
          partText: order.quote.rfqItem.freeTextAr ?? null,
          createdAt: formatTrackingDateTime(order.createdAt),
          timeline,
          finalPrice: formatCustomerOrderTotal(
            order.totalAmount,
            order.currency,
          ),
          payment: customerPaymentAction(order, paymentExperience),
        },
      };
    }

    return {
      error: 'صيغة رقم الطلب غير صحيحة — يبدأ بـ RFQ- أو ORD-.',
      values,
    };
  } catch (e) {
    console.error('trackRequest failed:', e);
    return { error: 'تعذّر جلب حالة الطلب. حاول مرة أخرى.', values };
  }
}
