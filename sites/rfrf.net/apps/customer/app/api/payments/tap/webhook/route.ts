import { PaymentStatus, prisma } from '@rafraf/db';
import { recoverFailedPaymentIntakeReference } from '@rafraf/orders';
import { STALE_INTAKE_CONFIRMED_ABSENT } from '@rafraf/shared/payments/payment-intake';
import {
  decideWebhookApplication,
  requiresEscrowHold,
  stateForProviderOutcome,
  type PaymentState,
} from '@rafraf/shared/payments/payment-state';
import type { NextRequest } from 'next/server';
import {
  tapBridgeConfig,
  tapSupabaseProviderFromEnv,
  verifyTapBridgeNotification,
} from '../../../../../lib/payments/tap-supabase-provider';
import { findEdfaPayWebhookPayment } from '../../../../../lib/payments/edfapay-webhook-payment';
import { settleConfirmedEdfaPayOutcome } from '../../../../../lib/payments/edfapay-capture-settlement';
import { resumePostCheckoutPolicyRefund } from '../../../../../lib/payments/edfapay-policy-refund';
import {
  ok,
  readPayload,
  retryLater,
  unauthorized,
} from '../../../../../lib/payments/edfapay-webhook-http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Supabase signs this internal notification after verifying Tap's webhook. */
export async function POST(request: NextRequest) {
  const config = tapBridgeConfig(),
    provider = tapSupabaseProviderFromEnv();
  if (!config || !provider) return retryLater();
  const envelope = await readPayload(request);
  if (
    !envelope ||
    !verifyTapBridgeNotification(
      new TextDecoder().decode(envelope.rawBody),
      request.headers.get('x-rafraf-timestamp'),
      request.headers.get('x-rafraf-signature'),
      config.serviceKey,
    )
  )
    return unauthorized();
  const signal = provider.parseWebhook(envelope.payload);
  if (!signal.orderCode || !signal.externalRef) return unauthorized();
  try {
    const lookup = await findEdfaPayWebhookPayment({
      provider: provider.name,
      orderCode: signal.orderCode,
      externalRef: signal.externalRef,
      refundWakeup: false,
    });
    // A missing local attempt can be a transaction propagation delay. Do not
    // consume the notification and strand a captured payment in Supabase.
    if (lookup.outcome !== 'FOUND') return retryLater();
    const payment = lookup.payment;
    if (payment.externalRef && payment.externalRef !== signal.externalRef)
      return retryLater();
    const confirmed = await provider.status(
      payment.providerOrderCode ?? signal.orderCode,
      signal.externalRef,
      payment.amount.toFixed(2),
      payment.currency,
    );

    if (confirmed.outcome === 'CAPTURED') {
      const resumed = await resumePostCheckoutPolicyRefund({
        payment,
        provider,
      });
      if (resumed === 'RETRY') return retryLater();
      if (resumed === 'RESUMED') return ok();
    }
    const recoverable =
      payment.status === PaymentStatus.FAILED &&
      payment.failureCode === STALE_INTAKE_CONFIRMED_ABSENT;
    const decision = decideWebhookApplication(
      (recoverable ? PaymentStatus.PENDING : payment.status) as PaymentState,
      confirmed.outcome,
    );
    if (decision !== 'apply') {
      if (decision === 'ignore' && payment.externalRef === null) {
        if (recoverable)
          await recoverFailedPaymentIntakeReference({
            paymentId: payment.id,
            orderId: payment.orderId,
            verifiedReference: signal.externalRef,
          });
        else
          await prisma.payment.updateMany({
            where: {
              id: payment.id,
              status: payment.status,
              externalRef: null,
            },
            data: { externalRef: signal.externalRef, failureCode: null },
          });
      }
      return ok();
    }
    const settlement = await settleConfirmedEdfaPayOutcome({
      payment,
      provider,
      nextStatus: stateForProviderOutcome(confirmed.outcome) as PaymentStatus,
      confirmedExternalRef: confirmed.externalRef,
      fallbackExternalRef: signal.externalRef,
      holdsEscrow: requiresEscrowHold(confirmed.outcome),
    });
    if (
      settlement === 'POLICY_REFUND_REQUESTED' ||
      (settlement === 'ALREADY_APPLIED' && confirmed.outcome === 'CAPTURED')
    ) {
      const resumed = await resumePostCheckoutPolicyRefund({
        payment,
        provider,
      });
      if (
        resumed === 'RETRY' ||
        (settlement === 'POLICY_REFUND_REQUESTED' && resumed !== 'RESUMED')
      )
        return retryLater();
    }
    return ok();
  } catch {
    // The durable attempt remains pending/held; Tap retries through Supabase.
    return retryLater();
  }
}
