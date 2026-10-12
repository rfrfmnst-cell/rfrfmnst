export type EInvoiceSubmissionStatus =
  'ACCEPTED' | 'REPORTED' | 'REJECTED' | 'PENDING' | 'UNKNOWN';

export interface EInvoiceSubmissionResult {
  provider: string;
  invoiceUuid: string;
  externalRef: string | null;
  status: EInvoiceSubmissionStatus;
  warningCodes: readonly string[];
  errorCodes: readonly string[];
}

export interface EInvoicingProvider {
  readonly name: string;
  submitInvoice(request: {
    idempotencyKey: string;
    invoiceUuid: string;
    invoiceHash: string;
    invoiceXml: string;
  }): Promise<EInvoiceSubmissionResult>;
  getSubmission(externalRef: string): Promise<EInvoiceSubmissionResult>;
}
