export type EbayBrowseErrorCode =
  | 'EBAY_QUERY_TOO_LONG'
  | 'EBAY_AUTH_FAILED'
  | 'EBAY_RATE_LIMITED'
  | 'EBAY_REQUEST_REJECTED'
  | 'EBAY_TIMEOUT'
  | 'EBAY_UNAVAILABLE'
  | 'EBAY_RESPONSE_INVALID';

export class EbayBrowseDiscoveryError extends Error {
  readonly code: EbayBrowseErrorCode;
  readonly retryable: boolean;

  constructor(code: EbayBrowseErrorCode, retryable: boolean) {
    super(code);
    this.name = 'EbayBrowseDiscoveryError';
    this.code = code;
    this.retryable = retryable;
  }
}
