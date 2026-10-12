export const MAX_CUSTOMER_ADDRESSES = 10;
export const CUSTOMER_ADDRESS_TRANSACTION_ATTEMPTS = 3;

const FOUR_DIGITS = /^\d{4}$/;
const FIVE_DIGITS = /^\d{5}$/;
const UNIT_NUMBER = /^\d{1,6}$/;

export interface CustomerAddressInput {
  label: string;
  city: string;
  district: string;
  street: string;
  buildingNumber: string;
  postalCode: string;
  additionalNumber: string | null;
  unitNumber: string | null;
  isDefault: boolean;
}

export type CustomerAddressValidation =
  | { ok: true; value: CustomerAddressInput }
  | { ok: false; error: string };

function compact(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ')
    : '';
}

function requestedDefault(value: unknown): boolean {
  return value === true || value === 'true' || value === 'on';
}

export function normalizeSaudiAddressDigits(value: unknown): string {
  return compact(value).replace(/[٠-٩۰-۹]/g, (digit) => {
    const codePoint = digit.charCodeAt(0);
    const zero = codePoint >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(codePoint - zero);
  });
}

export function isRetryableCustomerAddressTransaction(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2034'
  );
}

export function validateCustomerAddressInput(
  source: Record<string, unknown>,
): CustomerAddressValidation {
  const label = compact(source.label);
  const city = compact(source.city);
  const district = compact(source.district);
  const street = compact(source.street);
  const buildingNumber = normalizeSaudiAddressDigits(source.buildingNumber);
  const postalCode = normalizeSaudiAddressDigits(source.postalCode);
  const additionalNumber =
    normalizeSaudiAddressDigits(source.additionalNumber) || null;
  const unitNumber = normalizeSaudiAddressDigits(source.unitNumber) || null;

  if (label.length < 2 || label.length > 40) {
    return { ok: false, error: 'اسم العنوان يجب أن يكون بين حرفين و40 حرفاً.' };
  }
  if (city.length < 2 || city.length > 80) {
    return { ok: false, error: 'أدخل مدينة صحيحة حتى 80 حرفاً.' };
  }
  if (district.length < 2 || district.length > 80) {
    return { ok: false, error: 'أدخل حياً صحيحاً حتى 80 حرفاً.' };
  }
  if (street.length < 2 || street.length > 120) {
    return { ok: false, error: 'أدخل اسم شارع صحيحاً حتى 120 حرفاً.' };
  }
  if (!FOUR_DIGITS.test(buildingNumber)) {
    return { ok: false, error: 'رقم المبنى يجب أن يتكون من 4 أرقام.' };
  }
  if (!FIVE_DIGITS.test(postalCode)) {
    return { ok: false, error: 'الرمز البريدي يجب أن يتكون من 5 أرقام.' };
  }
  if (additionalNumber && !FOUR_DIGITS.test(additionalNumber)) {
    return { ok: false, error: 'الرقم الإضافي يجب أن يتكون من 4 أرقام.' };
  }
  if (unitNumber && !UNIT_NUMBER.test(unitNumber)) {
    return { ok: false, error: 'رقم الوحدة يجب أن يتكون من 1 إلى 6 أرقام.' };
  }

  return {
    ok: true,
    value: {
      label,
      city,
      district,
      street,
      buildingNumber,
      postalCode,
      additionalNumber,
      unitNumber,
      isDefault: requestedDefault(source.isDefault),
    },
  };
}

export function customerAddressAuditSnapshot(address: {
  additionalNumber: string | null;
  unitNumber: string | null;
  isDefault: boolean;
}) {
  return {
    hasAdditionalNumber: Boolean(address.additionalNumber),
    hasUnitNumber: Boolean(address.unitNumber),
    isDefault: address.isDefault,
  };
}
