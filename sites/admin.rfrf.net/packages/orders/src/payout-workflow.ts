import type {
  PayoutProvider,
  PayoutTransferResult,
} from '@rafraf/shared/payments/payout-provider';

export type AuditablePayoutStatus =
  | 'PENDING'
  | 'SCHEDULED'
  | 'APPROVED'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'PAID'
  | 'FAILED_RETRYABLE'
  | 'FAILED_FINAL'
  | 'ON_HOLD'
  | 'CANCELLED';

export interface AuditablePayout {
  id: string;
  amount: string;
  currency: string;
  status: AuditablePayoutStatus;
  provider: string | null;
  idempotencyKey: string | null;
  beneficiaryReference: string | null;
  makerId: string | null;
  checkerId: string | null;
  externalRef: string | null;
}

export interface PayoutWorkflowRepository {
  get(payoutId: string): Promise<AuditablePayout | null>;
  prepare(input: {
    payoutId: string;
    expectedStatus: 'PENDING' | 'FAILED_RETRYABLE';
    provider: string;
    idempotencyKey: string;
    beneficiaryReference: string;
    makerId: string;
  }): Promise<boolean>;
  approve(input: {
    payoutId: string;
    expectedStatus: 'SCHEDULED';
    checkerId: string;
    approvedAt: Date;
  }): Promise<boolean>;
  claimSubmission(input: {
    payoutId: string;
    expectedStatus: 'APPROVED';
  }): Promise<boolean>;
  recordProviderResult(input: {
    payoutId: string;
    expectedStatus: 'SUBMITTING' | 'SUBMITTED';
    status: 'SUBMITTED' | 'PAID' | 'FAILED_RETRYABLE' | 'FAILED_FINAL';
    externalRef: string | null;
    failureCode: string | null;
    submittedAt: Date;
    paidAt: Date | null;
  }): Promise<boolean>;
}

export type PayoutWorkflowOutcome =
  | 'PREPARED'
  | 'APPROVED'
  | 'SUBMITTED'
  | 'PAID'
  | 'RETRYABLE_FAILURE'
  | 'FINAL_FAILURE'
  | 'REPLAYED'
  | 'NOT_FOUND'
  | 'NOT_ACTIONABLE'
  | 'PERSISTENCE_CONFLICT'
  | 'MAKER_CHECKER_CONFLICT'
  | 'BENEFICIARY_REJECTED';

const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._~:/-]{5,159}$/u;

function safeReference(value: string): string | null {
  const normalized = value.trim();
  return SAFE_REFERENCE.test(normalized) ? normalized : null;
}

function providerResultStatus(result: PayoutTransferResult): {
  outcome: PayoutWorkflowOutcome;
  status: 'SUBMITTED' | 'PAID' | 'FAILED_RETRYABLE' | 'FAILED_FINAL';
} {
  if (result.status === 'SETTLED') return { outcome: 'PAID', status: 'PAID' };
  if (
    result.status === 'PENDING' ||
    result.status === 'SUBMITTED' ||
    result.status === 'UNKNOWN'
  ) {
    return { outcome: 'SUBMITTED', status: 'SUBMITTED' };
  }
  if (result.status === 'REJECTED') {
    return { outcome: 'FINAL_FAILURE', status: 'FAILED_FINAL' };
  }
  return { outcome: 'RETRYABLE_FAILURE', status: 'FAILED_RETRYABLE' };
}

export async function prepareSupplierPayout(input: {
  payoutId: string;
  providerName: string;
  beneficiaryReference: string;
  makerId: string;
  repository: PayoutWorkflowRepository;
}): Promise<PayoutWorkflowOutcome> {
  const provider = safeReference(input.providerName);
  const beneficiary = safeReference(input.beneficiaryReference);
  const makerId = safeReference(input.makerId);
  if (!provider || !beneficiary || !makerId) return 'NOT_ACTIONABLE';

  const payout = await input.repository.get(input.payoutId);
  if (!payout) return 'NOT_FOUND';
  if (
    payout.status === 'SCHEDULED' ||
    payout.status === 'APPROVED' ||
    payout.status === 'SUBMITTING' ||
    payout.status === 'SUBMITTED' ||
    payout.status === 'PAID'
  ) {
    return 'REPLAYED';
  }
  if (payout.status !== 'PENDING' && payout.status !== 'FAILED_RETRYABLE') {
    return 'NOT_ACTIONABLE';
  }
  const idempotencyKey = `supplier-payout:${payout.id}`;
  if (
    payout.status === 'FAILED_RETRYABLE' &&
    (payout.provider !== provider ||
      payout.idempotencyKey !== idempotencyKey ||
      payout.beneficiaryReference !== beneficiary ||
      payout.makerId !== makerId)
  ) {
    return 'NOT_ACTIONABLE';
  }

  const prepared = await input.repository.prepare({
    payoutId: payout.id,
    expectedStatus: payout.status,
    provider,
    idempotencyKey,
    beneficiaryReference: beneficiary,
    makerId,
  });
  return prepared ? 'PREPARED' : 'REPLAYED';
}

export async function approveSupplierPayout(input: {
  payoutId: string;
  checkerId: string;
  repository: PayoutWorkflowRepository;
  now?: Date;
}): Promise<PayoutWorkflowOutcome> {
  const checkerId = safeReference(input.checkerId);
  if (!checkerId) return 'NOT_ACTIONABLE';
  const payout = await input.repository.get(input.payoutId);
  if (!payout) return 'NOT_FOUND';
  if (
    payout.status === 'APPROVED' ||
    payout.status === 'SUBMITTING' ||
    payout.status === 'SUBMITTED' ||
    payout.status === 'PAID'
  ) {
    return 'REPLAYED';
  }
  if (payout.status !== 'SCHEDULED' || !payout.makerId) {
    return 'NOT_ACTIONABLE';
  }
  if (payout.makerId === checkerId) return 'MAKER_CHECKER_CONFLICT';
  const approved = await input.repository.approve({
    payoutId: payout.id,
    expectedStatus: 'SCHEDULED',
    checkerId,
    approvedAt: input.now ?? new Date(),
  });
  return approved ? 'APPROVED' : 'REPLAYED';
}

export async function submitSupplierPayout(input: {
  payoutId: string;
  provider: PayoutProvider;
  repository: PayoutWorkflowRepository;
  now?: Date;
}): Promise<PayoutWorkflowOutcome> {
  const payout = await input.repository.get(input.payoutId);
  if (!payout) return 'NOT_FOUND';
  if (payout.status === 'SUBMITTING' || payout.status === 'SUBMITTED') {
    return 'REPLAYED';
  }
  if (payout.status === 'PAID') return 'PAID';
  if (
    payout.status !== 'APPROVED' ||
    !payout.provider ||
    payout.provider !== input.provider.name ||
    !payout.idempotencyKey ||
    !payout.beneficiaryReference ||
    !payout.makerId ||
    !payout.checkerId ||
    payout.makerId === payout.checkerId
  ) {
    return 'NOT_ACTIONABLE';
  }
  if (
    !(await input.provider.validateBeneficiary(payout.beneficiaryReference))
  ) {
    return 'BENEFICIARY_REJECTED';
  }
  if (
    !(await input.repository.claimSubmission({
      payoutId: payout.id,
      expectedStatus: 'APPROVED',
    }))
  ) {
    return 'REPLAYED';
  }

  const now = input.now ?? new Date();
  let result: PayoutTransferResult;
  try {
    result = await input.provider.createTransfer({
      idempotencyKey: payout.idempotencyKey,
      payoutId: payout.id,
      beneficiaryReference: payout.beneficiaryReference,
      money: { amount: payout.amount, currency: payout.currency },
      description: `Rafraf supplier payout ${payout.id}`,
    });
  } catch {
    try {
      const recorded = await input.repository.recordProviderResult({
        payoutId: payout.id,
        expectedStatus: 'SUBMITTING',
        status: 'FAILED_RETRYABLE',
        externalRef: null,
        failureCode: 'PROVIDER_REQUEST_FAILED',
        submittedAt: now,
        paidAt: null,
      });
      return recorded ? 'RETRYABLE_FAILURE' : 'PERSISTENCE_CONFLICT';
    } catch {
      return 'PERSISTENCE_CONFLICT';
    }
  }
  const mapped = providerResultStatus(result);
  try {
    const recorded = await input.repository.recordProviderResult({
      payoutId: payout.id,
      expectedStatus: 'SUBMITTING',
      status: mapped.status,
      externalRef: result.externalRef,
      failureCode: result.failureCode,
      submittedAt: now,
      paidAt: result.settledAt,
    });
    return recorded ? mapped.outcome : 'PERSISTENCE_CONFLICT';
  } catch {
    return 'PERSISTENCE_CONFLICT';
  }
}

export async function reconcileSupplierPayout(input: {
  payoutId: string;
  provider: PayoutProvider;
  repository: PayoutWorkflowRepository;
  now?: Date;
}): Promise<PayoutWorkflowOutcome> {
  const payout = await input.repository.get(input.payoutId);
  if (!payout) return 'NOT_FOUND';
  if (payout.status === 'PAID') return 'PAID';
  if (
    payout.status !== 'SUBMITTED' ||
    !payout.externalRef ||
    payout.provider !== input.provider.name
  ) {
    return 'NOT_ACTIONABLE';
  }
  const result = await input.provider.getTransfer(payout.externalRef);
  const mapped = providerResultStatus(result);
  try {
    const recorded = await input.repository.recordProviderResult({
      payoutId: payout.id,
      expectedStatus: 'SUBMITTED',
      status: mapped.status,
      externalRef: result.externalRef,
      failureCode: result.failureCode,
      submittedAt: input.now ?? new Date(),
      paidAt: result.settledAt,
    });
    return recorded ? mapped.outcome : 'PERSISTENCE_CONFLICT';
  } catch {
    return 'PERSISTENCE_CONFLICT';
  }
}
