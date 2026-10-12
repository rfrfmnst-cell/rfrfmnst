export const MANUAL_BANK_TRANSFER_PROVIDER = 'MANUAL_BANK_TRANSFER' as const;
export const EDFAPAY_PAYMENT_PROVIDER = 'EDFAPAY' as const;

export const MANUAL_COD_BLOCK_REASON =
  'carrier_payment_proof_workflow_not_implemented' as const;
export const BANK_TRANSFER_REFERENCE_REQUIRED =
  'bank_transfer_reference_required' as const;
export const MANUAL_BANK_TRANSFER_BLOCK_REASON =
  'bank_transfer_verification_and_refund_workflow_not_implemented' as const;
export const MANUAL_REFUND_BLOCK_REASON =
  'manual_payment_refund_workflow_not_implemented' as const;
export const UNSUPPORTED_REFUND_PROVIDER =
  'unsupported_refund_provider' as const;

const BANK_REFERENCE_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{5,79}$/u;

type ManualPaymentBlockReason =
  | typeof MANUAL_COD_BLOCK_REASON
  | typeof BANK_TRANSFER_REFERENCE_REQUIRED
  | typeof MANUAL_BANK_TRANSFER_BLOCK_REASON
  | 'unsupported_manual_payment_method';

export type ManualPaymentDecision =
  | {
      allowed: true;
      method: 'BANK_TRANSFER';
      provider: typeof MANUAL_BANK_TRANSFER_PROVIDER;
      externalRef: string;
    }
  | {
      allowed: false;
      method: 'BANK_TRANSFER' | 'COD' | 'UNKNOWN';
      reason: ManualPaymentBlockReason;
    };

function normalizeBankReference(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return BANK_REFERENCE_PATTERN.test(normalized) ? normalized : null;
}

/**
 * Manual intake is closed today. A bank reference is validated for the future
 * workflow, but it is not evidence that money settled and cannot unlock a
 * CAPTURED payment. COD likewise needs authenticated carrier collection proof.
 */
export function manualPaymentDecision(
  methodValue: unknown,
  bankReferenceValue: unknown,
): ManualPaymentDecision {
  const method =
    typeof methodValue === 'string'
      ? methodValue.trim().toUpperCase()
      : 'UNKNOWN';

  if (method === 'COD') {
    return {
      allowed: false,
      method: 'COD',
      reason: MANUAL_COD_BLOCK_REASON,
    };
  }

  if (method !== 'BANK_TRANSFER') {
    return {
      allowed: false,
      method: 'UNKNOWN',
      reason: 'unsupported_manual_payment_method',
    };
  }

  const externalRef = normalizeBankReference(bankReferenceValue);
  if (!externalRef) {
    return {
      allowed: false,
      method: 'BANK_TRANSFER',
      reason: BANK_TRANSFER_REFERENCE_REQUIRED,
    };
  }

  const readiness = manualPaymentReadiness();
  if (!readiness.bankTransfer.enabled || !readiness.refunds.ready) {
    return {
      allowed: false,
      method: 'BANK_TRANSFER',
      reason: MANUAL_BANK_TRANSFER_BLOCK_REASON,
    };
  }

  return {
    allowed: true,
    method: 'BANK_TRANSFER',
    provider: MANUAL_BANK_TRANSFER_PROVIDER,
    externalRef,
  };
}

export type PaymentRefundRoute =
  | { allowed: true; provider: typeof EDFAPAY_PAYMENT_PROVIDER }
  | {
      allowed: false;
      reason:
        typeof MANUAL_REFUND_BLOCK_REASON | typeof UNSUPPORTED_REFUND_PROVIDER;
    };

/** Keeps an EdfaPay refund adapter from ever receiving a manual payment. */
export function paymentRefundRoute(provider: unknown): PaymentRefundRoute {
  if (provider === EDFAPAY_PAYMENT_PROVIDER) {
    return { allowed: true, provider: EDFAPAY_PAYMENT_PROVIDER };
  }
  if (typeof provider === 'string' && provider.startsWith('MANUAL_')) {
    return { allowed: false, reason: MANUAL_REFUND_BLOCK_REASON };
  }
  return { allowed: false, reason: UNSUPPORTED_REFUND_PROVIDER };
}

export function manualPaymentReadiness() {
  return {
    bankTransfer: {
      enabled: false,
      intakeReady: false,
      ready: false,
      requiredEvidence: 'authenticated_bank_settlement_proof',
      reason: MANUAL_BANK_TRANSFER_BLOCK_REASON,
    },
    cashOnDelivery: {
      enabled: false,
      ready: false,
      requiredEvidence: 'authenticated_carrier_collection_proof',
      reason: MANUAL_COD_BLOCK_REASON,
    },
    refunds: {
      enabled: false,
      ready: false,
      reason: MANUAL_REFUND_BLOCK_REASON,
    },
  } as const;
}
