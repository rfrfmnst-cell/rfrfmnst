export const CATALOG_CURRENCIES = ['SAR', 'USD', 'AED', 'EUR'] as const;
export const CATALOG_CONDITIONS = ['NEW', 'USED', 'REFURBISHED'] as const;

export type CatalogCurrency = (typeof CATALOG_CURRENCIES)[number];
export type CatalogCondition = (typeof CATALOG_CONDITIONS)[number];

export type CatalogItemInput = {
  partNumber: string;
  brand: string | null;
  condition: CatalogCondition;
  quantity: number;
  price: string;
  currency: CatalogCurrency;
  warrantyMonths: number;
  leadTimeDays: number;
  warehouseId: string | null;
};

export type CatalogItemValidation =
  | { ok: true; value: CatalogItemInput }
  | {
      ok: false;
      reason:
        | 'part_number'
        | 'brand'
        | 'condition'
        | 'quantity'
        | 'price'
        | 'currency'
        | 'warranty'
        | 'lead_time'
        | 'warehouse';
    };

type CatalogItemFormValues = {
  partNumber: string;
  brand: string;
  condition: string;
  quantity: string;
  price: string;
  currency: string;
  warrantyMonths: string;
  leadTimeDays: string;
  warehouseId: string;
};

function normalizeSpaces(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function hasUnsafeText(value: string): boolean {
  return /\p{Cc}/u.test(value) || /^[=+@]/.test(value);
}

function parseInteger(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
}

export function parseCatalogItemInput(
  values: CatalogItemFormValues,
): CatalogItemValidation {
  const partNumber = normalizeSpaces(values.partNumber).toUpperCase();
  if (
    partNumber.length < 2 ||
    partNumber.length > 80 ||
    !/^[A-Z0-9][A-Z0-9._/\- ]+$/.test(partNumber)
  ) {
    return { ok: false, reason: 'part_number' };
  }

  const brand = normalizeSpaces(values.brand);
  if (brand.length > 80 || (brand.length > 0 && hasUnsafeText(brand))) {
    return { ok: false, reason: 'brand' };
  }

  const condition = values.condition.trim().toUpperCase();
  if (!CATALOG_CONDITIONS.includes(condition as CatalogCondition)) {
    return { ok: false, reason: 'condition' };
  }

  const quantity = parseInteger(values.quantity.trim(), 0, 1_000_000);
  if (quantity == null) return { ok: false, reason: 'quantity' };

  const price = values.price.trim();
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(price) || Number(price) <= 0) {
    return { ok: false, reason: 'price' };
  }

  const currency = values.currency.trim().toUpperCase();
  if (!CATALOG_CURRENCIES.includes(currency as CatalogCurrency)) {
    return { ok: false, reason: 'currency' };
  }

  const warrantyMonths = parseInteger(
    values.warrantyMonths.trim() || '0',
    0,
    120,
  );
  if (warrantyMonths == null) return { ok: false, reason: 'warranty' };

  const leadTimeDays = parseInteger(values.leadTimeDays.trim() || '0', 0, 365);
  if (leadTimeDays == null) return { ok: false, reason: 'lead_time' };

  const warehouseId = values.warehouseId.trim();
  if (warehouseId && !/^[A-Za-z0-9_-]{1,80}$/.test(warehouseId)) {
    return { ok: false, reason: 'warehouse' };
  }

  return {
    ok: true,
    value: {
      partNumber,
      brand: brand || null,
      condition: condition as CatalogCondition,
      quantity,
      price: Number(price).toFixed(2),
      currency: currency as CatalogCurrency,
      warrantyMonths,
      leadTimeDays,
      warehouseId: warehouseId || null,
    },
  };
}

export function safeCatalogEntityId(value: string): string | null {
  const normalized = value.trim();
  return /^[A-Za-z0-9_-]{1,80}$/.test(normalized) ? normalized : null;
}

export function safeCatalogMutationToken(value: string): string | null {
  const normalized = value.trim();
  return /^[A-Za-z0-9-]{16,80}$/.test(normalized) ? normalized : null;
}
