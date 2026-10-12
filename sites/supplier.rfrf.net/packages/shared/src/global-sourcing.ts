export const GLOBAL_SOURCING_CAPABILITIES = ['SEARCH'] as const;
export const GLOBAL_SOURCING_MAX_RESULTS = 20;
export const GLOBAL_SOURCING_QUERY_MIN_LENGTH = 3;
export const GLOBAL_SOURCING_QUERY_MAX_LENGTH = 160;

export type GlobalSourcingCapability =
  (typeof GLOBAL_SOURCING_CAPABILITIES)[number];

export type GlobalSourcingContractErrorCode =
  | 'QUERY_REQUIRED'
  | 'QUERY_TOO_SHORT'
  | 'QUERY_TOO_LONG'
  | 'QUERY_WILDCARD_FORBIDDEN'
  | 'RESULT_LIMIT_INVALID';

export class GlobalSourcingContractError extends Error {
  readonly code: GlobalSourcingContractErrorCode;

  constructor(code: GlobalSourcingContractErrorCode) {
    super(code);
    this.name = 'GlobalSourcingContractError';
    this.code = code;
  }
}

export interface GlobalSourcingSearchRequest {
  query: string;
  limit: number;
}

export interface GlobalSourcingCandidateProvenance {
  providerKey: string;
  externalId: string;
  title: string;
  discoveredAt: string;
  itemWebUrl: string | null;
  listingMarketplaceId: string | null;
  itemLocationCountry: string | null;
  condition: string | null;
  buyingOptions: string[];
  fitmentEvidence: 'UNVERIFIED';
  /**
   * Narrow, non-customer-facing details required to assess a supplier offer.
   * This is intentionally not a raw provider payload and never proves fitment
   * or authorizes procurement.
   */
  supplierOffer?: {
    partNumber: string;
    manufacturer: string | null;
    deliveryEstimate: string | null;
    weightKg: number | null;
    minimumLot: number | null;
    warehouseCode: string | null;
    /** `false` when the supplier marks the offer as non-returnable. */
    returnable?: boolean | null;
  } | null;
}

export interface GlobalSourcingCandidate {
  externalId: string;
  title: string;
  rawPrice: number;
  currency: string;
  availability: string | null;
  provenance: GlobalSourcingCandidateProvenance;
}

export interface GlobalSourcingSearchResult {
  providerKey: string;
  capability: 'SEARCH';
  fetchedAt: string;
  candidates: GlobalSourcingCandidate[];
}

export interface GlobalSourcingProvider {
  readonly key: string;
  readonly capabilities: readonly ['SEARCH'];
  search(
    request: GlobalSourcingSearchRequest,
  ): Promise<GlobalSourcingSearchResult>;
}

/** VINs must never be forwarded to external sourcing providers. */
export function isVinLikeSearchQuery(value: string): boolean {
  const compact = value.replace(/[^A-Za-z0-9]/gu, '').toUpperCase();
  return /[A-HJ-NPR-Z0-9]{17}/u.test(compact);
}

export function normalizeGlobalSourcingSearchRequest(input: {
  query?: unknown;
  limit?: unknown;
}): GlobalSourcingSearchRequest {
  if (typeof input.query !== 'string') {
    throw new GlobalSourcingContractError('QUERY_REQUIRED');
  }

  const query = input.query.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (!query) throw new GlobalSourcingContractError('QUERY_REQUIRED');
  if (query.length < GLOBAL_SOURCING_QUERY_MIN_LENGTH) {
    throw new GlobalSourcingContractError('QUERY_TOO_SHORT');
  }
  if (query.length > GLOBAL_SOURCING_QUERY_MAX_LENGTH) {
    throw new GlobalSourcingContractError('QUERY_TOO_LONG');
  }
  if (query.includes('*')) {
    throw new GlobalSourcingContractError('QUERY_WILDCARD_FORBIDDEN');
  }

  const limit = input.limit ?? GLOBAL_SOURCING_MAX_RESULTS;
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > GLOBAL_SOURCING_MAX_RESULTS
  ) {
    throw new GlobalSourcingContractError('RESULT_LIMIT_INVALID');
  }

  return { query, limit };
}
