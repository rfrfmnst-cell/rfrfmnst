export type CustomerProfileReadiness = {
  hasEmail: boolean;
  hasDefaultAddress: boolean;
  hasDefaultVehicle: boolean;
};

export function customerProfileSetupPending(
  readiness: CustomerProfileReadiness,
): boolean {
  return !(
    readiness.hasEmail &&
    readiness.hasDefaultAddress &&
    readiness.hasDefaultVehicle
  );
}
