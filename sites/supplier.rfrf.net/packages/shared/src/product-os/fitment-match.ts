export interface FitmentVehicle {
  make: string;
  model: string;
  year: number;
  engine: string | null;
  marketSpec: string | null;
}

export interface PartCompatibilityFitment {
  make: string;
  model: string;
  yearFrom: number;
  yearTo: number;
  engine: string | null;
  marketSpec: string | null;
}

function normalizeFitmentValue(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase('en') ?? '';
}

/**
 * A catalog row may omit engine or market spec to mean "all variants". Once it
 * declares either dimension, the vehicle must provide the same value.
 */
export function matchesVehiclePartCompatibility(
  vehicle: FitmentVehicle,
  compatibility: PartCompatibilityFitment,
): boolean {
  const engine = normalizeFitmentValue(compatibility.engine);
  const marketSpec = normalizeFitmentValue(compatibility.marketSpec);

  return (
    normalizeFitmentValue(compatibility.make) ===
      normalizeFitmentValue(vehicle.make) &&
    normalizeFitmentValue(compatibility.model) ===
      normalizeFitmentValue(vehicle.model) &&
    vehicle.year >= compatibility.yearFrom &&
    vehicle.year <= compatibility.yearTo &&
    (engine.length === 0 || engine === normalizeFitmentValue(vehicle.engine)) &&
    (marketSpec.length === 0 ||
      marketSpec === normalizeFitmentValue(vehicle.marketSpec))
  );
}
