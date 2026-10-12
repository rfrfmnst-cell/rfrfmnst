import { ActorType, OrderStatus, prisma } from '@rafraf/db';
import { settleDeliveredOrder, type SettleOrderResult } from './settlement';

export type ReceiptConfirmationOutcome =
  | 'NOT_AVAILABLE'
  | 'NOT_ACTIONABLE'
  | 'RECORDED';

export interface ConfirmReceiptInput {
  orderId: string;
  customerId: string;
}

export interface ConfirmReceiptResult {
  outcome: ReceiptConfirmationOutcome;
  /** نتيجة محاولة التسوية الفورية، إن وصل التأكيد إلى تلك المرحلة. */
  settlement?: SettleOrderResult;
}

/**
 * تأكيد العميل استلام طلبه.
 *
 * التأكيد فعل توثيقي أولاً: يُسجَّل دائماً حتى لو لم يُفرج المال بعده، لأن
 * طلباً مصعَّداً للمراجعة يجب أن يصل العمليات ومعه علم أن العميل استلم ورضي.
 * ثم تُحاول التسوية فوراً — وهي التي تقرّر، لا هذا الفعل.
 *
 * التسجيل والإفراج معاملتان لا واحدة عن قصد: قفل التسوية مأخوذ على الطلب،
 * وأخذه مرتين متداخلتين يخاطر بجمود متبادل مع مسار العمليات على الطلب نفسه.
 * الفصل آمن لأن التسجيل idempotent، والتسوية تقرأ الطابع من قاعدة البيانات.
 */
export async function confirmCustomerReceipt(
  input: ConfirmReceiptInput,
  client: typeof prisma = prisma,
): Promise<ConfirmReceiptResult> {
  const stamped = await client.order.updateMany({
    where: {
      id: input.orderId,
      customerId: input.customerId,
      status: OrderStatus.COMPLAINT_WINDOW,
      customerConfirmedAt: null,
    },
    data: { customerConfirmedAt: new Date() },
  });

  if (stamped.count !== 1) {
    // إما ليس طلبه، أو ليس في نافذة الشكوى، أو أكّد سابقاً. الحالة الثالثة
    // ليست خطأً: نمضي إلى التسوية بدل رفض ضغطة ثانية.
    const order = await client.order.findFirst({
      where: { id: input.orderId, customerId: input.customerId },
      select: { status: true, customerConfirmedAt: true },
    });
    if (!order) return { outcome: 'NOT_AVAILABLE' };
    if (
      order.status !== OrderStatus.COMPLAINT_WINDOW ||
      !order.customerConfirmedAt
    ) {
      return { outcome: 'NOT_ACTIONABLE' };
    }
  }

  if (stamped.count === 1) {
    // التأكيد ليس انتقالاً، فتُترك `fromStatus` فارغة: الطلب بقي في نافذته
    // وهذه حاشية عليها. كتابتها كحالة تساوي نفسها كانت ستقرأ في الخط الزمني
    // كأن الطلب تحرّك ولم يتحرّك. لا نكرر الحاشية عند إعادة الطلب.
    await client.orderEvent.create({
      data: {
        orderId: input.orderId,
        toStatus: OrderStatus.COMPLAINT_WINDOW,
        actorType: ActorType.CUSTOMER,
        actorId: input.customerId,
        note: 'أكّد العميل استلام الطلب سليماً',
      },
    });

    await client.auditLog.create({
      data: {
        actorId: input.customerId,
        actorType: ActorType.CUSTOMER,
        action: 'order.customer.receipt_confirmed',
        entityType: 'order',
        entityId: input.orderId,
        before: { customerConfirmedAt: null },
        after: { customerConfirmed: true, escrowAction: 'NONE' },
      },
    });
  }

  const settlement = await settleDeliveredOrder(
    {
      orderId: input.orderId,
      customerId: input.customerId,
      actorId: input.customerId,
      actorType: ActorType.CUSTOMER,
      customerConfirmed: true,
    },
    client,
  );

  return { outcome: 'RECORDED', settlement };
}
