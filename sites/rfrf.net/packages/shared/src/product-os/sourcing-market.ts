export const SOURCING_MARKETS = ['SAUDI', 'GCC', 'GLOBAL'] as const;

export type SourcingMarket = (typeof SOURCING_MARKETS)[number];
export type StoredQuoteSourceType = 'LOCAL' | 'GLOBAL';

export type SupplierRfqScope = {
  rfqStatus: 'SOURCING_LOCAL' | 'SOURCING_GLOBAL';
  quoteSourceType: StoredQuoteSourceType;
};

export const GCC_SOURCE_COUNTRY_CODES = ['AE', 'BH', 'KW', 'OM', 'QA'] as const;

const GCC_COUNTRY_SET = new Set<string>(GCC_SOURCE_COUNTRY_CODES);
const ISO_3166_ALPHA_2 = new Set(
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(
    ' ',
  ),
);

export function normalizeCountryCode(value: unknown): string | null {
  const code = String(value ?? '')
    .trim()
    .toUpperCase();
  return ISO_3166_ALPHA_2.has(code) ? code : null;
}

export function isSourcingMarket(value: unknown): value is SourcingMarket {
  return (
    typeof value === 'string' &&
    (SOURCING_MARKETS as readonly string[]).includes(value)
  );
}

/**
 * Keeps supplier opportunities and supplier-created quotes in one country
 * boundary. Invalid or missing country data receives no sourcing scope.
 */
export function resolveSupplierRfqScope(
  countryCode: unknown,
): SupplierRfqScope | null {
  const country = normalizeCountryCode(countryCode);
  if (!country) return null;

  return country === 'SA'
    ? { rfqStatus: 'SOURCING_LOCAL', quoteSourceType: 'LOCAL' }
    : { rfqStatus: 'SOURCING_GLOBAL', quoteSourceType: 'GLOBAL' };
}

/**
 * QuoteSourceType remains the persisted business-rule distinction:
 * LOCAL versus GLOBAL. GCC is a customer-facing subdivision of GLOBAL.
 */
export function resolveSourcingMarket(
  sourceType: StoredQuoteSourceType,
  sourceCountry?: string | null,
): SourcingMarket {
  if (sourceType === 'LOCAL') return 'SAUDI';

  const country = normalizeCountryCode(sourceCountry);
  return country && GCC_COUNTRY_SET.has(country) ? 'GCC' : 'GLOBAL';
}

/**
 * The quote's origin is the country of its SourceRegistry row. Only a quote
 * with no registry row at all (submitted through the supplier portal) takes
 * the approved supplier's registered country instead; a registry row with a
 * missing or invalid country stays an unknown origin.
 */
export function quoteOriginCountry(quote: {
  sourceRegistry?: { country?: string | null } | null;
  supplier?: { countryCode?: string | null } | null;
}): string | null {
  return quote.sourceRegistry
    ? (quote.sourceRegistry.country ?? null)
    : (quote.supplier?.countryCode ?? null);
}

/**
 * Validates the manually entered origin without inventing a country.
 * Saudi quotes do not need a SourceRegistry row; their canonical code is SA.
 */
export function sourceCountryForMarket(
  market: SourcingMarket,
  value: unknown,
): string | null {
  if (market === 'SAUDI') return 'SA';

  const country = normalizeCountryCode(value);
  if (!country) return null;

  if (market === 'GCC') {
    return GCC_COUNTRY_SET.has(country) ? country : null;
  }

  return country !== 'SA' && !GCC_COUNTRY_SET.has(country) ? country : null;
}

export interface RankedMarketQuote {
  market: SourcingMarket;
  decisionScore: number | null;
}

export interface SourcingMarketComparison<T> {
  quotes: T[];
  missingMarkets: SourcingMarket[];
}

/**
 * Selects at most one real quote per market.
 * Equal scores preserve input order, so callers should order by score desc/id asc.
 */
export function compareSourcingMarkets<T extends RankedMarketQuote>(
  candidates: readonly T[],
): SourcingMarketComparison<T> {
  const selected = new Map<SourcingMarket, T>();

  const score = (value: number | null) =>
    value != null && Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const current = selected.get(candidate.market);
    if (
      !current ||
      score(candidate.decisionScore) > score(current.decisionScore)
    ) {
      selected.set(candidate.market, candidate);
    }
  }

  const quotes: T[] = [];
  const missingMarkets: SourcingMarket[] = [];

  for (const market of SOURCING_MARKETS) {
    const quote = selected.get(market);
    if (quote) quotes.push(quote);
    else missingMarkets.push(market);
  }

  return { quotes, missingMarkets };
}
