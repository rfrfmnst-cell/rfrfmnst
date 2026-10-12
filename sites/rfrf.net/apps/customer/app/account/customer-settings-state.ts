export function customerSettingsInitialExpansion(
  addressCount: number,
  vehicleCount: number,
): { address: boolean; vehicle: boolean } {
  const address = addressCount === 0;
  return {
    address,
    vehicle: !address && vehicleCount === 0,
  };
}
