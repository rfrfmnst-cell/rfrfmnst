export const SUPPLIER_PAYOUT_INVALID_REFERENCE =
  'supplier_payout_reference_invalid' as const;
export const SUPPLIER_PAYOUT_WORKFLOW_NOT_READY =
  'supplier_payout_bank_settlement_and_approval_workflow_not_ready' as const;

const PAYOUT_REFERENCE = /^[A-Z0-9][A-Z0-9._/-]{5,79}$/u;

export function normalizeSupplierPayoutReference(
  value: unknown,
): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return PAYOUT_REFERENCE.test(normalized) ? normalized : null;
}

/**
 * Supplier payout is a core release dependency, not a manual attestation.
 * Every control remains hard-coded closed until a real implementation can
 * prove all three in one workflow: bank execution, settled evidence, and two
 * distinct authorized operators.
 */
export function supplierPayoutReadiness() {
  return {
    enabled: false,
    ready: false,
    reason: SUPPLIER_PAYOUT_WORKFLOW_NOT_READY,
    bankAdapter: {
      enabled: false,
      ready: false,
      requiredEvidence: 'idempotent_bank_transfer_provider_reference',
    },
    settlementEvidence: {
      enabled: false,
      ready: false,
      requiredEvidence: 'provider_confirmed_final_settlement',
    },
    makerChecker: {
      enabled: false,
      ready: false,
      requiredEvidence: 'distinct_authorized_maker_and_checker',
    },
  } as const;
}

export type SupplierPayoutRecordingDecision =
  | {
      allowed: false;
      normalizedReference: null;
      reason: typeof SUPPLIER_PAYOUT_INVALID_REFERENCE;
    }
  | {
      allowed: false;
      normalizedReference: string;
      reason: typeof SUPPLIER_PAYOUT_WORKFLOW_NOT_READY;
    };

export function supplierPayoutRecordingDecision(
  reference: unknown,
): SupplierPayoutRecordingDecision {
  const normalizedReference = normalizeSupplierPayoutReference(reference);
  if (!normalizedReference) {
    return {
      allowed: false,
      normalizedReference: null,
      reason: SUPPLIER_PAYOUT_INVALID_REFERENCE,
    };
  }

  return {
    allowed: false,
    normalizedReference,
    reason: SUPPLIER_PAYOUT_WORKFLOW_NOT_READY,
  };
}
