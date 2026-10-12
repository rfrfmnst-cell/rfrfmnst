export const MIN_CUSTOMER_VEHICLE_YEAR = 1950;
export const CUSTOMER_VEHICLE_VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

export interface CustomerVehicleInput {
  make: string;
  model: string;
  year: number;
  engine: string | null;
  marketSpec: string | null;
  vin: string | null;
  plate: string | null;
  isDefault: boolean;
}

export type CustomerVehicleValidation =
  | { ok: true; value: CustomerVehicleInput }
  | { ok: false; error: string };

function compact(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ')
    : '';
}

function optional(value: unknown): string | null {
  const normalized = compact(value);
  return normalized || null;
}

function requestedDefault(value: unknown): boolean {
  return value === true || value === 'true' || value === 'on';
}

function normalizeCustomerVehicleVin(value: string): string | null {
  const normalized = value.toUpperCase().replace(/[\s-]+/g, '');
  return CUSTOMER_VEHICLE_VIN_PATTERN.test(normalized) ? normalized : null;
}

export function maxCustomerVehicleYear(currentYear = new Date().getUTCFullYear()) {
  return currentYear + 1;
}

export function validateCustomerVehicleInput(
  source: Record<string, unknown>,
  currentYear = new Date().getUTCFullYear(),
): CustomerVehicleValidation {
  const make = compact(source.make);
  const model = compact(source.model);
  if (!make || make.length > 60)
    return { ok: false, error: 'أدخل اسم شركة صحيحاً حتى 60 حرفاً.' };
  if (!model || model.length > 80)
    return { ok: false, error: 'أدخل اسم موديل صحيحاً حتى 80 حرفاً.' };

  const year = Number(compact(source.year));
  const maxYear = maxCustomerVehicleYear(currentYear);
  if (
    !Number.isInteger(year) ||
    year < MIN_CUSTOMER_VEHICLE_YEAR ||
    year > maxYear
  ) {
    return {
      ok: false,
      error: `سنة الصنع يجب أن تكون بين ${MIN_CUSTOMER_VEHICLE_YEAR} و${maxYear}.`,
    };
  }

  const engine = optional(source.engine);
  const marketSpec = optional(source.marketSpec);
  const plate = optional(source.plate)?.toUpperCase() ?? null;
  if (engine && engine.length > 80)
    return { ok: false, error: 'وصف المحرك يجب ألا يتجاوز 80 حرفاً.' };
  if (marketSpec && marketSpec.length > 40)
    return { ok: false, error: 'مواصفات السوق يجب ألا تتجاوز 40 حرفاً.' };
  if (plate && plate.length > 20)
    return { ok: false, error: 'رقم اللوحة يجب ألا يتجاوز 20 حرفاً.' };

  const rawVin = compact(source.vin);
  const vin = rawVin ? normalizeCustomerVehicleVin(rawVin) : null;
  if (rawVin && !vin) {
    return {
      ok: false,
      error: 'رقم الهيكل يجب أن يكون 17 خانة ولا يحتوي I أو O أو Q.',
    };
  }

  return {
    ok: true,
    value: {
      make,
      model,
      year,
      engine,
      marketSpec,
      vin,
      plate,
      isDefault: requestedDefault(source.isDefault),
    },
  };
}

export function customerVehicleAuditSnapshot(vehicle: {
  vin: string | null;
  isDefault: boolean;
}) {
  return {
    hasVin: Boolean(vehicle.vin),
    isDefault: vehicle.isDefault,
  };
}

export function maskCustomerVehicleVin(vin: string | null): string {
  return vin ? `•••• ${vin.slice(-6)}` : 'VIN غير محفوظ';
}
