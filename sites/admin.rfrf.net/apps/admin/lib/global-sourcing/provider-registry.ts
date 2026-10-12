import type { GlobalSourcingProvider } from '@rafraf/shared/global-sourcing';
import {
  ABCP_PART_NUMBER_MAX_LENGTH,
  ABCP_PROVIDER_KEY,
  ABCP_PROVIDER_NAME,
  AbcpDiscoveryError,
  abcpDiscoveryStatus,
  configuredAbcpDiscovery,
  normalizeAbcpPartNumber,
} from './abcp.ts';
import {
  APM_PROVIDER_KEY,
  APM_PROVIDER_NAME,
  APM_SEARCH_CODE_MAX_LENGTH,
  ApmDiscoveryError,
  apmDiscoveryStatus,
  configuredApmDiscovery,
  normalizeApmSearchCode,
} from './apm.ts';
import {
  EBAY_BROWSE_PROVIDER_KEY,
  EBAY_BROWSE_PROVIDER_NAME,
  EBAY_BROWSE_QUERY_MAX_LENGTH,
  EbayBrowseDiscoveryError,
  configuredEbayBrowseDiscovery,
  ebayBrowseDiscoveryStatus,
} from './ebay-browse.ts';

export const GLOBAL_DISCOVERY_PROVIDER_KEYS = [
  EBAY_BROWSE_PROVIDER_KEY,
  APM_PROVIDER_KEY,
  ABCP_PROVIDER_KEY,
] as const;

export type GlobalDiscoveryProviderKey =
  (typeof GLOBAL_DISCOVERY_PROVIDER_KEYS)[number];

/** A secret-free view that can safely be passed from an admin Server Component. */
export interface GlobalDiscoveryProviderStatus {
  key: GlobalDiscoveryProviderKey;
  label: string;
  configured: boolean;
  inputLabel: string;
  inputHint: string;
  maxQueryLength: number;
  sourceName: string;
}

export interface GlobalDiscoveryProviderRuntime {
  status: GlobalDiscoveryProviderStatus;
  provider: GlobalSourcingProvider | null;
  sourceCountry: string | null;
  sourceUrl: string;
  sourceNotes: string;
  /** Never contains query, VIN, token, account or any other secret. */
  runMetadata: Record<string, string>;
  /** The provider's error code for a query it cannot accept, or null. */
  queryError(query: string): string | null;
  /** The provider's error for a result that breaks the search contract. */
  invalidResponse(): Error;
}

/** Part-number providers reject anything their normalizer refuses. */
function partNumberError(
  normalize: (query: string) => string,
  fallbackCode: string,
): (query: string) => string | null {
  return (query) => {
    try {
      normalize(query);
      return null;
    } catch (error) {
      return error instanceof ApmDiscoveryError ||
        error instanceof AbcpDiscoveryError
        ? error.code
        : fallbackCode;
    }
  };
}

function ebayRuntime(): GlobalDiscoveryProviderRuntime {
  const status = ebayBrowseDiscoveryStatus();
  const marketplaceId = status.marketplaceId;
  const deliveryCountry = status.deliveryCountry;
  return {
    status: {
      key: EBAY_BROWSE_PROVIDER_KEY,
      label: EBAY_BROWSE_PROVIDER_NAME,
      configured: status.configured,
      inputLabel: 'رقم OEM أو وصف البحث',
      inputHint: 'يقبل رقم OEM أو وصفاً مختصراً؛ الشحن يُقيّد إلى السعودية.',
      maxQueryLength: EBAY_BROWSE_QUERY_MAX_LENGTH,
      sourceName: marketplaceId
        ? `${EBAY_BROWSE_PROVIDER_NAME} — ${marketplaceId}`
        : EBAY_BROWSE_PROVIDER_NAME,
    },
    provider: configuredEbayBrowseDiscovery(),
    sourceCountry: null,
    sourceUrl: 'https://developer.ebay.com/develop/api/buy/browse_api',
    sourceNotes:
      'Admin-only SEARCH discovery; no supplier account, dashboard, quote, procurement, or purchase capability.',
    runMetadata: {
      ...(marketplaceId ? { marketplaceId } : {}),
      ...(deliveryCountry ? { deliveryCountry } : {}),
    },
    queryError: (query) =>
      query.length > EBAY_BROWSE_QUERY_MAX_LENGTH
        ? 'EBAY_QUERY_TOO_LONG'
        : null,
    invalidResponse: () =>
      new EbayBrowseDiscoveryError('EBAY_RESPONSE_INVALID', false),
  };
}

function apmRuntime(): GlobalDiscoveryProviderRuntime {
  const status = apmDiscoveryStatus();
  return {
    status: {
      key: APM_PROVIDER_KEY,
      label: APM_PROVIDER_NAME,
      configured: status.configured,
      inputLabel: 'رقم OEM أو رقم القطعة',
      inputHint:
        'يقبل رقم القطعة فقط (حروف/أرقام/./-/_). لا يرسل VIN ولا ينفذ طلب شراء.',
      maxQueryLength: APM_SEARCH_CODE_MAX_LENGTH,
      sourceName: 'APM Group — UAE',
    },
    provider: configuredApmDiscovery(),
    sourceCountry: 'AE',
    sourceUrl: 'https://apm.group/webservice',
    sourceNotes:
      'Admin-only SEARCH discovery through a contracted APM account; no supplier identity, quote, procurement, or purchase is created.',
    runMetadata: { originCountry: 'AE' },
    queryError: partNumberError(normalizeApmSearchCode, 'APM_CODE_INVALID'),
    invalidResponse: () => new ApmDiscoveryError('APM_RESPONSE_INVALID', false),
  };
}

function abcpRuntime(): GlobalDiscoveryProviderRuntime {
  const status = abcpDiscoveryStatus();
  return {
    status: {
      key: ABCP_PROVIDER_KEY,
      label: ABCP_PROVIDER_NAME,
      configured: status.configured,
      inputLabel: 'رقم OEM أو رقم القطعة',
      inputHint:
        'يقبل رقم القطعة فقط. يبحث في مخزون تجار الجملة في الإمارات على ABCP وقوائم أسعارهم، دون المستودعات الإلكترونية والبدائل؛ النتيجة الفارغة لا تعني أن لا أحد يحملها. لا يرسل VIN ولا ينفذ طلب شراء.',
      maxQueryLength: ABCP_PART_NUMBER_MAX_LENGTH,
      sourceName: 'ABCP — UAE wholesalers',
    },
    provider: configuredAbcpDiscovery(),
    sourceCountry: 'AE',
    sourceUrl: 'https://www.abcp.ru/d/docs/api/abcp1/api-abcp-client',
    sourceNotes:
      'Admin-only SEARCH discovery across contracted UAE wholesaler accounts on ABCP; no supplier identity, quote, procurement, or purchase is created.',
    runMetadata: {
      originCountry: 'AE',
      supplierCount: String(status.supplierCount),
    },
    queryError: partNumberError(normalizeAbcpPartNumber, 'ABCP_CODE_INVALID'),
    invalidResponse: () =>
      new AbcpDiscoveryError('ABCP_RESPONSE_INVALID', false),
  };
}

export function globalDiscoveryProviderStatuses(): GlobalDiscoveryProviderStatus[] {
  return [ebayRuntime().status, apmRuntime().status, abcpRuntime().status];
}

export function globalDiscoveryProviderRuntime(
  value: unknown,
): GlobalDiscoveryProviderRuntime | null {
  if (value === EBAY_BROWSE_PROVIDER_KEY) return ebayRuntime();
  if (value === APM_PROVIDER_KEY) return apmRuntime();
  if (value === ABCP_PROVIDER_KEY) return abcpRuntime();
  return null;
}
