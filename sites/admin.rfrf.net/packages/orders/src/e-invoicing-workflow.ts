import type {
  EInvoicingProvider,
  EInvoiceSubmissionResult,
} from '@rafraf/shared/invoicing/e-invoicing-provider';

export type AuditableInvoiceStatus =
  | 'CREATED'
  | 'PENDING'
  | 'ACCEPTED'
  | 'REPORTED'
  | 'REJECTED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_FINAL';

export interface AuditableInvoiceSubmission {
  id: string;
  invoiceUuid: string;
  invoiceHash: string;
  idempotencyKey: string;
  status: AuditableInvoiceStatus;
  provider: string | null;
  externalRef: string | null;
}

export interface EInvoicingWorkflowRepository {
  get(invoiceId: string): Promise<AuditableInvoiceSubmission | null>;
  claim(input: {
    invoiceId: string;
    expectedStatus: 'CREATED' | 'FAILED_RETRYABLE';
    provider: string;
  }): Promise<boolean>;
  record(input: {
    invoiceId: string;
    expectedStatus: 'PENDING';
    status: Exclude<AuditableInvoiceStatus, 'CREATED' | 'PENDING'>;
    externalRef: string | null;
    failureCode: string | null;
    submittedAt: Date;
  }): Promise<boolean>;
}

export type EInvoicingWorkflowOutcome =
  | 'ACCEPTED'
  | 'REPORTED'
  | 'REJECTED'
  | 'RETRYABLE_FAILURE'
  | 'REPLAYED'
  | 'NOT_FOUND'
  | 'NOT_ACTIONABLE'
  | 'PERSISTENCE_CONFLICT';

function outcome(result: EInvoiceSubmissionResult): {
  result: EInvoicingWorkflowOutcome;
  status: 'ACCEPTED' | 'REPORTED' | 'REJECTED' | 'FAILED_RETRYABLE';
  failureCode: string | null;
} {
  if (result.status === 'ACCEPTED') {
    return { result: 'ACCEPTED', status: 'ACCEPTED', failureCode: null };
  }
  if (result.status === 'REPORTED') {
    return { result: 'REPORTED', status: 'REPORTED', failureCode: null };
  }
  if (result.status === 'REJECTED') {
    return {
      result: 'REJECTED',
      status: 'REJECTED',
      failureCode: result.errorCodes[0] ?? 'PROVIDER_REJECTED',
    };
  }
  return {
    result: 'RETRYABLE_FAILURE',
    status: 'FAILED_RETRYABLE',
    failureCode: result.errorCodes[0] ?? 'PROVIDER_PENDING',
  };
}

export async function submitElectronicInvoice(input: {
  invoiceId: string;
  invoiceXml: string;
  provider: EInvoicingProvider;
  repository: EInvoicingWorkflowRepository;
  now?: Date;
}): Promise<EInvoicingWorkflowOutcome> {
  const invoice = await input.repository.get(input.invoiceId);
  if (!invoice) return 'NOT_FOUND';
  if (
    invoice.status === 'ACCEPTED' ||
    invoice.status === 'REPORTED' ||
    invoice.status === 'REJECTED'
  ) {
    return 'REPLAYED';
  }
  if (invoice.status === 'PENDING') return 'REPLAYED';
  if (
    (invoice.status !== 'CREATED' && invoice.status !== 'FAILED_RETRYABLE') ||
    !invoice.invoiceUuid ||
    !invoice.invoiceHash ||
    !invoice.idempotencyKey ||
    !input.invoiceXml.trim()
  ) {
    return 'NOT_ACTIONABLE';
  }
  if (
    invoice.status === 'FAILED_RETRYABLE' &&
    invoice.provider !== input.provider.name
  ) {
    return 'NOT_ACTIONABLE';
  }
  if (
    !(await input.repository.claim({
      invoiceId: invoice.id,
      expectedStatus: invoice.status,
      provider: input.provider.name,
    }))
  ) {
    return 'REPLAYED';
  }
  const now = input.now ?? new Date();
  let providerResult: EInvoiceSubmissionResult;
  try {
    providerResult = invoice.externalRef
      ? await input.provider.getSubmission(invoice.externalRef)
      : await input.provider.submitInvoice({
          idempotencyKey: invoice.idempotencyKey,
          invoiceUuid: invoice.invoiceUuid,
          invoiceHash: invoice.invoiceHash,
          invoiceXml: input.invoiceXml,
        });
  } catch {
    try {
      const recorded = await input.repository.record({
        invoiceId: invoice.id,
        expectedStatus: 'PENDING',
        status: 'FAILED_RETRYABLE',
        externalRef: invoice.externalRef,
        failureCode: 'PROVIDER_REQUEST_FAILED',
        submittedAt: now,
      });
      return recorded ? 'RETRYABLE_FAILURE' : 'PERSISTENCE_CONFLICT';
    } catch {
      return 'PERSISTENCE_CONFLICT';
    }
  }
  const mapped = outcome(providerResult);
  try {
    const recorded = await input.repository.record({
      invoiceId: invoice.id,
      expectedStatus: 'PENDING',
      status: mapped.status,
      externalRef: providerResult.externalRef ?? invoice.externalRef,
      failureCode: mapped.failureCode,
      submittedAt: now,
    });
    return recorded ? mapped.result : 'PERSISTENCE_CONFLICT';
  } catch {
    return 'PERSISTENCE_CONFLICT';
  }
}
