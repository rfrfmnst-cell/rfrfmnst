'use server';

/**
 * لوحة العمليات — الأفعال التي توصل محرّك القرار المختبَر (@rafraf/shared) بقاعدة
 * الإنتاج. كل عرض يدوي يمرّ بـ computeLandedCost، وكل مجموعة عروض تُرتَّب بـ
 * rankQuoteSet — نفس الدوال النقية المغطّاة بـ9 اختبارات (سقف القرار 0.88).
 */

import { revalidatePath } from 'next/cache';
import { prisma, RFQStatus, ActorType, OrderStatus } from '@rafraf/db';
// استيراد المسارات الفرعية النقية مباشرة (entry.ts يصدّر بقايا سكافولد NestJS
// يستخدمها apps/api — سحبها داخل Next يفشل البناء بـclass-transformer).
import {
  assertRfqTransition,
  type RfqState,
} from '@rafraf/shared/workflow/rfq-state';
import { assertOrderTransition } from '@rafraf/shared/workflow/order-state';
import { recordManualPayment } from '../lib/payments/manual-payment';
import { requireAdminPermission } from '../lib/require-admin-session';
import {
  markSupplierPayoutPaid,
  refundPayment,
  resolveStalePaymentIntake,
  settleDeliveredOrder,
} from '@rafraf/orders';
import { edfaPayRefundProviderFromEnv } from '@rafraf/shared/payments/edfapay-refund-provider';
import { paymentRefundRoute } from '@rafraf/shared/payments/manual-payment-policy';

/** تحديث حالة RFQ من اللوحة (تم التواصل / مراجعة / إلخ). */
export async function updateRfqStatus(fd: FormData): Promise<void> {
  const admin = await requireAdminPermission('RFQ_WRITE');
  const rfqId = String(fd.get('rfqId') ?? '');
  const status = String(fd.get('status') ?? '') as RFQStatus;
  if (!rfqId || !(status in RFQStatus)) return;
  // Only customer quote approval may convert an RFQ: it creates the order
  // atomically with the status change under the RFQ decision lock.
  if (status === RFQStatus.CONVERTED_TO_ORDER) return;
  await prisma.$transaction(async (tx) => {
    const lockKey = `admin:rfq-status:${rfqId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const current = await tx.rFQ.findUnique({
      where: { id: rfqId },
      select: { status: true },
    });
    if (!current || current.status === status) return;

    // الخريطة هي المرجع، لا التعداد: عضوية `status` في `RFQStatus` تثبت أن
    // القيمة موجودة، لا أن الانتقال إليها مشروع من الحالة الحالية. بدون هذا
    // السطر يمرّ CANCELLED → DRAFT بصمت.
    assertRfqTransition(current.status as RfqState, status as RfqState);

    const updated = await tx.rFQ.updateMany({
      where: { id: rfqId, status: current.status },
      data: { status },
    });
    if (updated.count !== 1) throw new Error('RFQ status changed concurrently');

    await tx.auditLog.create({
      data: {
        actorId: admin.userId,
        actorType: ActorType.ADMIN,
        action: 'rfq.status.change',
        entityType: 'rfq',
        entityId: rfqId,
        before: { status: current.status },
        after: { status },
      },
    });
  });
  revalidatePath(`/rfq/${rfqId}`);
  revalidatePath('/');
}

/** بوابة دفع يدوي مغلقة حتى يكتمل إثبات التحصيل ومسار الرد الموثق. */
export async function markPaid(fd: FormData): Promise<void> {
  const admin = await requireAdminPermission('PAYMENT_WRITE');
  const orderId = String(fd.get('orderId') ?? '');
  const rfqId = String(fd.get('rfqId') ?? '');
  if (!orderId) return;
  try {
    const outcome = await recordManualPayment({
      orderId,
      actorId: admin.userId,
      method: fd.get('method'),
      bankReference: fd.get('bankReference'),
    });
    if (outcome !== 'RECORDED') return;
  } catch (error) {
    console.error('markPaid failed:', error);
    return;
  }
  if (rfqId) revalidatePath(`/rfq/${rfqId}`);
  revalidatePath('/');
}

/**
 * بوابة المطابقة قبل الشحن: تنقل الطلب من قبول المورد إلى تحقق المطابقة.
 *
 * المورد يملك حركة البضاعة، لكنه لا يملك إجازة توافق القطعة مع مركبة العميل —
 * وإلا صار الطرف المستفيد من الشحن هو نفسه من يشهد بصلاحيته. لذلك تبقى هذه
 * الخطوة وحدها بيد العمليات وخلف صلاحية FITMENT_APPROVE، ولا يفتح مسار الشحن
 * في بوابة المورد قبل اجتيازها.
 */
export async function verifyOrderFitment(fd: FormData): Promise<void> {
  const admin = await requireAdminPermission('FITMENT_APPROVE');
  const orderId = String(fd.get('orderId') ?? '');
  const rfqId = String(fd.get('rfqId') ?? '');
  if (!orderId) return;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`admin:order-fitment:${orderId}`}))`;

      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { id: true, status: true },
      });
      // إعادة التشغيل ليست خطأً: زرّ مضغوط مرتين يجب أن ينتهي بالحالة نفسها.
      if (!order || order.status !== OrderStatus.SUPPLIER_ACCEPTED) return;

      assertOrderTransition('SUPPLIER_ACCEPTED', 'FITMENT_VERIFIED');
      const verified = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.SUPPLIER_ACCEPTED },
        data: { status: OrderStatus.FITMENT_VERIFIED },
      });
      if (verified.count !== 1) return;

      await tx.orderEvent.create({
        data: {
          orderId,
          fromStatus: OrderStatus.SUPPLIER_ACCEPTED,
          toStatus: OrderStatus.FITMENT_VERIFIED,
          actorId: admin.userId,
          actorType: ActorType.ADMIN,
          note: 'اعتمدت العمليات توافق القطعة قبل الشحن',
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: admin.userId,
          actorType: ActorType.ADMIN,
          action: 'order.fitment.verified',
          entityType: 'order',
          entityId: orderId,
          before: { status: OrderStatus.SUPPLIER_ACCEPTED },
          after: {
            status: OrderStatus.FITMENT_VERIFIED,
            escrowAction: 'NONE',
          },
        },
      });
    });
  } catch (error) {
    console.error(
      'verifyOrderFitment failed:',
      error instanceof Error ? error.name : 'UNKNOWN',
    );
    return;
  }

  if (rfqId) revalidatePath(`/rfq/${encodeURIComponent(rfqId)}`);
  revalidatePath('/');
}

/**
 * إفراج الضمان بعد التسليم: يغلق نافذة الشكوى ويصرف مستحق المورد.
 *
 * الإفراج آلي في المسار الطبيعي، وهذا الفعل هو المظلّة البشرية فوقه: يشغّله
 * مشغّل لطلب انتهت نافذته، أو يتجاوز به تصعيد خطر بعد مراجعته. الشكوى المفتوحة
 * لا تُتجاوز من هنا — لها مسارها.
 */
export async function releaseOrderEscrow(fd: FormData): Promise<void> {
  const admin = await requireAdminPermission('PAYMENT_WRITE');
  const orderId = String(fd.get('orderId') ?? '');
  const rfqId = String(fd.get('rfqId') ?? '');
  const opsOverride = String(fd.get('opsOverride') ?? '') === 'true';
  if (!orderId) return;

  try {
    await settleDeliveredOrder({
      orderId,
      actorId: admin.userId,
      actorType: ActorType.ADMIN,
      opsOverride,
    });
  } catch (error) {
    console.error(
      'releaseOrderEscrow failed:',
      error instanceof Error ? error.name : 'UNKNOWN',
    );
    return;
  }

  if (rfqId) revalidatePath(`/rfq/${encodeURIComponent(rfqId)}`);
  revalidatePath('/');
}

/** بوابة صرف المورد مغلقة حتى يكتمل bank adapter والدليل وmaker-checker. */
export async function recordSupplierPayoutPaid(fd: FormData): Promise<void> {
  const admin = await requireAdminPermission('PAYMENT_WRITE');
  const payoutId = String(fd.get('payoutId') ?? '');
  const reference = String(fd.get('reference') ?? '');
  if (!payoutId || !reference) return;

  const outcome = await markSupplierPayoutPaid({
    payoutId,
    reference,
    actorId: admin.userId,
  });
  if (outcome !== 'PAID' && outcome !== 'REPLAYED') return;
  revalidatePath('/');
}

/**
 * يفك حجز محاولة checkout مجهولة النتيجة بعد مراجعة EdfaPay يدويًا.
 * يبقى providerOrderCode ثابتًا، لذلك أي callback متأخر يُربط بالمحاولة
 * الأصلية ويمر بحماية التحصيل المكرر بدل أن يضيع.
 */
export async function resolveStaleEdfaPayIntake(fd: FormData): Promise<void> {
  const admin = await requireAdminPermission('PAYMENT_WRITE');
  const paymentId = String(fd.get('paymentId') ?? '');
  const confirmOrderCode = String(fd.get('confirmOrderCode') ?? '');
  const reviewReference = String(fd.get('reviewReference') ?? '');
  if (!paymentId || !confirmOrderCode || !reviewReference) return;

  await resolveStalePaymentIntake({
    paymentId,
    confirmOrderCode,
    reviewReference,
    actorId: admin.userId,
  });
  revalidatePath('/');
}

/** استرداد كامل محكوم بسجل دائم؛ يلزم تأكيد كود الطلب حرفياً. */
export async function refundEdfaPayPayment(fd: FormData): Promise<void> {
  const admin = await requireAdminPermission('PAYMENT_WRITE');
  const paymentId = String(fd.get('paymentId') ?? '');
  const confirmOrderCode = String(fd.get('confirmOrderCode') ?? '');
  if (!paymentId || !confirmOrderCode) return;

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { provider: true },
  });
  const refundRoute = paymentRefundRoute(payment?.provider);
  if (!refundRoute.allowed) {
    if (payment) {
      await prisma.auditLog.create({
        data: {
          actorId: admin.userId,
          actorType: ActorType.ADMIN,
          action: 'payment.refund.blocked.unsupported_provider',
          entityType: 'payment',
          entityId: paymentId,
          after: { reason: refundRoute.reason },
        },
      });
    }
    return;
  }

  const provider = edfaPayRefundProviderFromEnv();
  if (!provider) return;

  await refundPayment({
    paymentId,
    actorId: admin.userId,
    confirmOrderCode,
    provider,
  });
  revalidatePath('/');
}
