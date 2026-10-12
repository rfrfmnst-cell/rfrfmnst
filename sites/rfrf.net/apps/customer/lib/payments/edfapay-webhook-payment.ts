import { PaymentStatus, Prisma, prisma } from '@rafraf/db';

export const edfaPayWebhookPaymentSelect = {
  id: true,
  status: true,
  amount: true,
  currency: true,
  externalRef: true,
  providerOrderCode: true,
  failureCode: true,
  orderId: true,
  order: { select: { code: true, status: true, supplierId: true } },
} satisfies Prisma.PaymentSelect;

export type EdfaPayWebhookPayment = Prisma.PaymentGetPayload<{
  select: typeof edfaPayWebhookPaymentSelect;
}>;

export type EdfaPayWebhookPaymentLookup =
  | { outcome: 'FOUND'; payment: EdfaPayWebhookPayment }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'AMBIGUOUS' };

/** Resolve refund ids before purchase ids; never choose among two candidates. */
export async function findEdfaPayWebhookPayment(
  input: {
    provider: string;
    orderCode: string;
    externalRef: string | null;
    refundWakeup: boolean;
  },
  client: typeof prisma = prisma,
): Promise<EdfaPayWebhookPaymentLookup> {
  if (input.refundWakeup && input.externalRef) {
    const refund = await client.paymentRefund.findFirst({
      where: {
        externalRef: input.externalRef,
        payment: {
          provider: input.provider,
          OR: [
            { providerOrderCode: input.orderCode },
            { order: { code: input.orderCode } },
          ],
        },
      },
      select: { payment: { select: edfaPayWebhookPaymentSelect } },
    });
    if (refund) return { outcome: 'FOUND', payment: refund.payment };
  }

  const providerOrderPayment = await client.payment.findFirst({
    where: {
      provider: input.provider,
      providerOrderCode: input.orderCode,
    },
    select: edfaPayWebhookPaymentSelect,
  });
  if (providerOrderPayment) {
    return { outcome: 'FOUND', payment: providerOrderPayment };
  }

  if (input.externalRef) {
    const payment = await client.payment.findUnique({
      where: {
        provider_externalRef: {
          provider: input.provider,
          externalRef: input.externalRef,
        },
      },
      select: edfaPayWebhookPaymentSelect,
    });
    if (payment) {
      return payment.providerOrderCode === input.orderCode ||
        payment.order.code === input.orderCode
        ? { outcome: 'FOUND', payment }
        : { outcome: 'NOT_FOUND' };
    }
  }

  const candidates = await client.payment.findMany({
    where: {
      order: { code: input.orderCode },
      provider: input.provider,
      OR: input.refundWakeup
        ? [
            { externalRef: null, status: PaymentStatus.PENDING },
            { status: { in: [PaymentStatus.CAPTURED, PaymentStatus.HELD] } },
          ]
        : [{ externalRef: null, status: PaymentStatus.PENDING }],
    },
    select: edfaPayWebhookPaymentSelect,
    take: 2,
  });
  if (candidates.length > 1) return { outcome: 'AMBIGUOUS' };
  return candidates[0]
    ? { outcome: 'FOUND', payment: candidates[0] }
    : { outcome: 'NOT_FOUND' };
}
