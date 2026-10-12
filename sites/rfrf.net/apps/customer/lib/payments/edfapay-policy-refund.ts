import { ActorType, PaymentRefundStatus, prisma } from '@rafraf/db';
import { refundPayment } from '@rafraf/orders';
import type { RefundPaymentProvider } from '@rafraf/shared/payments/edfapay-refund-provider';
import type { EdfaPayWebhookPayment } from './edfapay-webhook-payment';

export const POST_CHECKOUT_POLICY_REFUND_PREFIX = 'POST_CHECKOUT_POLICY_BLOCK_';
export const POST_CHECKOUT_POLICY_REFUND_REASON = 'POST_CHECKOUT_POLICY';

const RESUMABLE_POLICY_REFUND_STATUSES = new Set<PaymentRefundStatus>([
  PaymentRefundStatus.REQUESTED,
  PaymentRefundStatus.PROCESSING,
  PaymentRefundStatus.PROVIDER_PENDING,
]);

/** Resume a refund reserved by capture quarantine after a crash or replay. */
export async function resumePostCheckoutPolicyRefund(input: {
  payment: EdfaPayWebhookPayment;
  provider: RefundPaymentProvider;
}): Promise<'ABSENT' | 'RESUMED' | 'RETRY'> {
  const operation = await prisma.paymentRefund.findUnique({
    where: { paymentId: input.payment.id },
    select: { status: true, reasonCode: true },
  });
  if (operation?.reasonCode !== POST_CHECKOUT_POLICY_REFUND_REASON) {
    return 'ABSENT';
  }
  if (operation.status === PaymentRefundStatus.COMPLETED) return 'RESUMED';
  if (!RESUMABLE_POLICY_REFUND_STATUSES.has(operation.status)) return 'RETRY';

  try {
    const outcome = await refundPayment({
      paymentId: input.payment.id,
      actorId: 'edfapay-webhook',
      actorType: ActorType.SYSTEM,
      confirmOrderCode: input.payment.order.code,
      provider: input.provider,
    });
    if (outcome !== 'COMPLETED' && outcome !== 'REPLAYED') {
      console.error('[payments:edfapay] policy refund could not resume', {
        code: 'POST_CHECKOUT_POLICY_REFUND_PENDING',
        paymentId: input.payment.id,
        outcome,
      });
      return 'RETRY';
    }
    return 'RESUMED';
  } catch (error) {
    console.error('[payments:edfapay] policy refund resume failed', {
      code: 'POST_CHECKOUT_POLICY_REFUND_RESUME_FAILED',
      paymentId: input.payment.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'RETRY';
  }
}
