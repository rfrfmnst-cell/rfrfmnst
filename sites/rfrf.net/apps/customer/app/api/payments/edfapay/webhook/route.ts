import { ActorType, PaymentStatus, prisma } from '@rafraf/db';
import {
  FINANCIAL_RECONCILIATION_FAILURE,
  PARTIAL_REFUND_FAILURE,
  isDuplicateCaptureFailure,
  recoverFailedPaymentIntakeReference,
  reconcileConfirmedRefund,
  reconcileDuplicateCaptureRefund,
  reserveProviderRefundReconciliation,
} from '@rafraf/orders';
import { STALE_INTAKE_CONFIRMED_ABSENT } from '@rafraf/shared/payments/payment-intake';
import {
  decideWebhookApplication,
  requiresEscrowHold,
  stateForProviderOutcome,
} from '@rafraf/shared/payments/payment-state';
import type { PaymentState } from '@rafraf/shared/payments/payment-state';
import {
  EDFAPAY_WEBHOOK_SIGNATURE_HEADER,
  edfaPayWebhookSecretFromEnv,
  verifyEdfaPayWebhookSignature,
} from '@rafraf/shared/payments/edfapay-signature';
import type { NextRequest } from 'next/server';
import { settleConfirmedEdfaPayOutcome } from '../../../../../lib/payments/edfapay-capture-settlement';
import { resumePostCheckoutPolicyRefund } from '../../../../../lib/payments/edfapay-policy-refund';
import { edfaPayProviderFromEnv } from '../../../../../lib/payments/edfapay-provider';
import { findEdfaPayWebhookPayment } from '../../../../../lib/payments/edfapay-webhook-payment';
import { recordEdfaPayWebhookEvidence } from '../../../../../lib/payments/edfapay-webhook-evidence';
import {
  ok,
  readPayload,
  retryLater,
  unauthorized,
} from '../../../../../lib/payments/edfapay-webhook-http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * مستقبِل إشعار EdfaPay.
 *
 * الإشعار إشارة لا حقيقة: يُقرأ منه معرّف الطلب فقط، ثم تُؤكَّد الحالة عبر
 * استدعاء حالة موثّق بـ`X-API-KEY` خادم-لخادم. لا تُبنى أي حركة مالية على
 * جسم الإشعار نفسه، حتى لو ادّعت حمولة مزوّرة أن الدفعة نجحت.
 *
 * المزوّد ينتظر «OK» نصية؛ أي رد آخر يجعله يعيد المحاولة — وهو السلوك
 * المطلوب عند أي عطل مؤقت لدينا.
 */

export async function POST(request: NextRequest) {
  const provider = edfaPayProviderFromEnv();
  const webhookSecret = edfaPayWebhookSecretFromEnv();
  if (!provider || !webhookSecret) {
    console.error('[payments:edfapay] provider is not configured');
    return retryLater();
  }

  const envelope = await readPayload(request);
  if (!envelope) return ok(); // حمولة مشوَّهة: إعادة إرسالها لن تصلحها.
  if (
    !verifyEdfaPayWebhookSignature({
      rawBody: envelope.rawBody,
      secret: webhookSecret,
      signature: request.headers.get(EDFAPAY_WEBHOOK_SIGNATURE_HEADER),
    })
  ) {
    console.error('[payments:edfapay] invalid webhook signature', {
      code: 'WEBHOOK_SIGNATURE_INVALID',
    });
    return unauthorized();
  }

  const signal = provider.parseWebhook(envelope.payload);
  if (!signal.orderCode) return ok();
  const refundWakeup =
    signal.operation === 'REFUND' || signal.outcome === 'REFUNDED';
  const lookup = await findEdfaPayWebhookPayment({
    provider: provider.name,
    orderCode: signal.orderCode,
    externalRef: signal.externalRef,
    refundWakeup,
  });
  if (lookup.outcome === 'AMBIGUOUS') {
    console.error('[payments:edfapay] ambiguous refund notification', {
      code: 'PAYMENT_REFUND_REFERENCE_AMBIGUOUS',
    });
    return retryLater();
  }
  if (lookup.outcome === 'NOT_FOUND') {
    console.error('[payments:edfapay] notification for an unknown payment', {
      code: 'PAYMENT_NOT_FOUND',
    });
    return ok();
  }
  const payment = lookup.payment;

  const externalRef = signal.externalRef ?? payment.externalRef;
  if (!externalRef) return ok();

  let statusOrderCode = payment.providerOrderCode ?? signal.orderCode;
  let statusExternalRef = externalRef;
  let statusAmount = payment.amount.toFixed(2);
  let statusCurrency = payment.currency;
  let refundReservationFailure: string | null = null;
  let refundReservationDuplicateCapture = false;
  if (refundWakeup) {
    // Reserve under the same financial lock as settlement before the network
    // lookup. Otherwise settlement could release money while status is in
    // flight for a refund the provider has already started.
    const reservation = await reserveProviderRefundReconciliation({
      paymentId: payment.id,
      actorId: 'edfapay-webhook',
      provider: provider.name,
      refundExternalRef: signal.externalRef,
    });
    if (reservation.outcome === 'REPLAYED') return ok();
    if (
      reservation.outcome !== 'RESERVED' ||
      !reservation.purchaseExternalRef
    ) {
      return retryLater();
    }
    statusOrderCode = reservation.providerOrderCode;
    statusExternalRef = reservation.purchaseExternalRef;
    statusAmount = reservation.amount;
    statusCurrency = reservation.currency;
    refundReservationFailure = reservation.failureCode;
    refundReservationDuplicateCapture = reservation.duplicateCapture;
  }

  if (refundReservationFailure === FINANCIAL_RECONCILIATION_FAILURE) {
    console.error('[payments:edfapay] refund reference conflict', {
      code: FINANCIAL_RECONCILIATION_FAILURE,
      paymentId: payment.id,
    });
    return ok();
  }

  // مصدر الحقيقة: استدعاء API-key خادمي، لا جسم الإشعار.
  let confirmed;
  try {
    confirmed = await provider.status(
      statusOrderCode,
      statusExternalRef,
      statusAmount,
      statusCurrency,
    );
  } catch (error) {
    console.error('[payments:edfapay] status confirmation failed', {
      code: 'STATUS_CONFIRMATION_FAILED',
      error: error instanceof Error ? error.message : String(error),
    });
    return retryLater();
  }

  await recordEdfaPayWebhookEvidence({
    paymentId: payment.id,
    requestUrl: request.url,
    transactionId: statusExternalRef,
    providerOrderCode: statusOrderCode,
    amount: statusAmount,
    currency: statusCurrency,
  });

  if (confirmed.reconciliationIssue === PARTIAL_REFUND_FAILURE) {
    const held = await reserveProviderRefundReconciliation({
      paymentId: payment.id,
      actorId: 'edfapay-webhook',
      provider: provider.name,
      refundExternalRef: signal.externalRef,
      failureCode: PARTIAL_REFUND_FAILURE,
    });
    return held.outcome === 'NOT_FOUND' ? retryLater() : ok();
  }
  if (refundWakeup && confirmed.outcome !== 'REFUNDED') {
    // The signed wake-up arrived before the read model reflected the refund.
    // Keep the durable reservation and ask the provider to retry later.
    return retryLater();
  }

  // A refund is a financial resolution, including a replay after local state
  // already reached REFUNDED. Handle it before generic same-state decisions so
  // a late signed refund id can recover a crash-window operation reference.
  if (confirmed.outcome === 'REFUNDED') {
    const reconciliationInput = {
      paymentId: payment.id,
      actorId: 'edfapay-webhook',
      actorType: ActorType.SYSTEM,
      provider: provider.name,
      externalRef: refundWakeup ? signal.externalRef : null,
    };
    const reconciliation =
      refundReservationDuplicateCapture ||
      isDuplicateCaptureFailure(refundReservationFailure)
        ? await reconcileDuplicateCaptureRefund(reconciliationInput)
        : await reconcileConfirmedRefund(reconciliationInput);
    if (reconciliation === 'RECONCILIATION_REQUIRED') {
      console.error('[payments:edfapay] refund requires reconciliation', {
        code: 'FINANCIAL_RESOLUTION_CONFLICT',
        paymentId: payment.id,
      });
    }
    return reconciliation === 'NOT_FOUND' ? retryLater() : ok();
  }

  // A crash may happen after capture was durably quarantined but before the
  // refund provider call. A replay of the purchase callback must resume that
  // durable operation even though the Payment row is already CAPTURED.
  if (confirmed.outcome === 'CAPTURED') {
    const resumedPolicyRefund = await resumePostCheckoutPolicyRefund({
      payment,
      provider,
    });
    if (resumedPolicyRefund === 'RESUMED') return ok();
    if (resumedPolicyRefund === 'RETRY') return retryLater();
  }

  const recoverableFailedIntake =
    payment.status === PaymentStatus.FAILED &&
    payment.failureCode === STALE_INTAKE_CONFIRMED_ABSENT;
  const decision = decideWebhookApplication(
    (recoverableFailedIntake
      ? PaymentStatus.PENDING
      : payment.status) as PaymentState,
    confirmed.outcome,
  );
  if (decision !== 'apply') {
    // Initiate may return no transaction id. A signed, provider-confirmed
    // same-state callback must still bind the reference for later recovery.
    const verifiedReference = confirmed.externalRef ?? externalRef;
    if (
      decision === 'ignore' &&
      payment.externalRef === null &&
      verifiedReference
    ) {
      if (recoverableFailedIntake) {
        await recoverFailedPaymentIntakeReference({
          paymentId: payment.id,
          orderId: payment.orderId,
          verifiedReference,
        });
      } else {
        await prisma.payment.updateMany({
          where: {
            id: payment.id,
            status: payment.status,
            externalRef: null,
          },
          data: { externalRef: verifiedReference, failureCode: null },
        });
      }
    }
    if (decision === 'reject') {
      console.error('[payments:edfapay] refused a stale notification', {
        code: 'PAYMENT_TRANSITION_REJECTED',
      });
    }
    return ok();
  }

  // التعيين يعيش في المنطق المشترك؛ تكراره هنا يعيد الطبقتين إلى الاختلاف.
  const nextStatus = stateForProviderOutcome(
    confirmed.outcome,
  ) as PaymentStatus;
  const holdsEscrow = requiresEscrowHold(confirmed.outcome);

  let settlement;
  try {
    settlement = await settleConfirmedEdfaPayOutcome({
      payment,
      provider,
      nextStatus,
      confirmedExternalRef: confirmed.externalRef,
      fallbackExternalRef: externalRef,
      holdsEscrow,
    });
  } catch (error) {
    console.error('[payments:edfapay] settlement failed', {
      code: 'PAYMENT_SETTLEMENT_FAILED',
      error: error instanceof Error ? error.message : String(error),
    });
    return retryLater();
  }

  if (
    settlement === 'ALREADY_APPLIED' &&
    confirmed.outcome === 'CAPTURED'
  ) {
    // This callback may have read PENDING before another worker committed a
    // quarantine, then lost the CAS after that worker crashed. Re-read the
    // durable refund identity before acknowledging the provider callback.
    const resumedPolicyRefund = await resumePostCheckoutPolicyRefund({
      payment,
      provider,
    });
    if (resumedPolicyRefund === 'RETRY') return retryLater();
    return ok();
  }
  if (settlement === 'ALREADY_APPLIED') return ok();
  if (settlement === 'POLICY_REFUND_REQUESTED') {
    const resumedPolicyRefund = await resumePostCheckoutPolicyRefund({
      payment,
      provider,
    });
    if (resumedPolicyRefund === 'RESUMED') return ok();
    return retryLater();
  }

  return ok();
}
