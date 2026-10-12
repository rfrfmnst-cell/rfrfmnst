export interface CarrierShipmentEvidence {
  provider?: string | null;
  trackingNumber?: string | null;
  status?: string | null;
}

const INTERNAL_PROVIDERS = new Set(['MOCK', 'RAFRAF_INTERNAL']);
const PROVIDER_PATTERN = /^[A-Z0-9][A-Z0-9._-]{1,39}$/i;

const ACCEPTED_STATUSES_BY_STEP: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    SHIPPED: [
      'PICKED_UP',
      'IN_TRANSIT',
      'CUSTOMS',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ],
    IN_TRANSIT: ['IN_TRANSIT', 'CUSTOMS', 'OUT_FOR_DELIVERY', 'DELIVERED'],
    OUT_FOR_DELIVERY: ['OUT_FOR_DELIVERY', 'DELIVERED'],
    DELIVERED: ['DELIVERED'],
  });

/** Internal preview labels are never evidence that a carrier accepted goods. */
export function isExternalCarrierShipment(
  shipment: CarrierShipmentEvidence | null | undefined,
): boolean {
  const provider = shipment?.provider?.trim() ?? '';
  const trackingNumber = shipment?.trackingNumber?.trim() ?? '';
  return (
    PROVIDER_PATTERN.test(provider) &&
    !INTERNAL_PROVIDERS.has(provider.toUpperCase()) &&
    !provider.toUpperCase().startsWith('SUPPLIER_MANAGED_') &&
    trackingNumber.length >= 4 &&
    trackingNumber.length <= 160
  );
}

/** A supplier declaration is not carrier evidence until an admin attests it. */
export function isSupplierManagedShipment(
  shipment: CarrierShipmentEvidence | null | undefined,
): boolean {
  return Boolean(
    shipment?.provider?.trim().toUpperCase().startsWith('SUPPLIER_MANAGED_'),
  );
}

export function carrierShipmentSupportsOrderStep(
  step: string,
  shipment: CarrierShipmentEvidence | null | undefined,
): boolean {
  if (!isExternalCarrierShipment(shipment)) return false;
  const accepted = ACCEPTED_STATUSES_BY_STEP[step];
  return Boolean(shipment?.status && accepted?.includes(shipment.status));
}

export function isExternalCarrierDeliveryProof(
  shipment: CarrierShipmentEvidence | null | undefined,
): boolean {
  return carrierShipmentSupportsOrderStep('DELIVERED', shipment);
}
