import { safeEbayItemUrl } from './ebay-browse.ts';

/** What the admin panel shows for one stored discovery candidate. */
export interface StoredCandidateView {
  title: string | null;
  itemWebUrl: string | null;
  buyingOptions: string[];
  /** `USED` when the provider marks the part as used. */
  condition: string | null;
  supplierOffer: {
    partNumber: string;
    manufacturer: string | null;
    deliveryEstimate: string | null;
    weightKg: number | null;
    minimumLot: number | null;
    warehouseCode: string | null;
    /** `false` only when the supplier marks the offer non-returnable. */
    returnable: false | null;
  } | null;
}

/** Parses a candidate's stored notes defensively; nothing here is trusted. */
export function storedCandidateView(notes: string | null): StoredCandidateView {
  if (!notes) {
    return {
      title: null,
      itemWebUrl: null,
      buyingOptions: [],
      condition: null,
      supplierOffer: null,
    };
  }
  try {
    const value = JSON.parse(notes) as Record<string, unknown>;
    const title =
      typeof value.title === 'string' ? value.title.slice(0, 160) : null;
    const buyingOptions = Array.isArray(value.buyingOptions)
      ? value.buyingOptions
          .filter((option): option is string => typeof option === 'string')
          .slice(0, 4)
      : [];
    const itemWebUrl = safeEbayItemUrl(
      value.itemWebUrl,
      value.listingMarketplaceId,
    );
    const offer =
      value.supplierOffer !== null &&
      typeof value.supplierOffer === 'object' &&
      !Array.isArray(value.supplierOffer)
        ? (value.supplierOffer as Record<string, unknown>)
        : null;
    const partNumber =
      typeof offer?.partNumber === 'string'
        ? offer.partNumber.slice(0, 80)
        : null;
    const supplierOffer = partNumber
      ? {
          partNumber,
          manufacturer:
            typeof offer?.manufacturer === 'string'
              ? offer.manufacturer.slice(0, 100)
              : null,
          deliveryEstimate:
            typeof offer?.deliveryEstimate === 'string'
              ? offer.deliveryEstimate.slice(0, 80)
              : null,
          weightKg:
            typeof offer?.weightKg === 'number' &&
            Number.isFinite(offer.weightKg) &&
            offer.weightKg >= 0
              ? offer.weightKg
              : null,
          minimumLot:
            typeof offer?.minimumLot === 'number' &&
            Number.isFinite(offer.minimumLot) &&
            offer.minimumLot >= 1
              ? offer.minimumLot
              : null,
          warehouseCode:
            typeof offer?.warehouseCode === 'string'
              ? offer.warehouseCode.slice(0, 80)
              : null,
          returnable: offer?.returnable === false ? (false as const) : null,
        }
      : null;
    const condition =
      typeof value.condition === 'string' ? value.condition.slice(0, 40) : null;
    return { title, itemWebUrl, buyingOptions, condition, supplierOffer };
  } catch {
    return {
      title: null,
      itemWebUrl: null,
      buyingOptions: [],
      condition: null,
      supplierOffer: null,
    };
  }
}
