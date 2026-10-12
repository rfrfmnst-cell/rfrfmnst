import { ShipmentStatus } from '@rafraf/db';

const STATUS_MAP = new Map<string, ShipmentStatus>([
  ['shipmentprocessing', ShipmentStatus.PENDING],
  ['assignedtowarehouse', ShipmentStatus.PENDING],
  ['shipmentcreated', ShipmentStatus.LABEL_CREATED],
  ['pickedup', ShipmentStatus.PICKED_UP],
  ['intransit', ShipmentStatus.IN_TRANSIT],
  ['outfordelivery', ShipmentStatus.OUT_FOR_DELIVERY],
  ['delivered', ShipmentStatus.DELIVERED],
  ['returned', ShipmentStatus.RETURNED],
  ['lost', ShipmentStatus.LOST],
]);

const PROGRESS = new Map<ShipmentStatus, number>([
  [ShipmentStatus.PENDING, 0],
  [ShipmentStatus.LABEL_CREATED, 1],
  [ShipmentStatus.PICKED_UP, 2],
  [ShipmentStatus.IN_TRANSIT, 3],
  [ShipmentStatus.CUSTOMS, 4],
  [ShipmentStatus.OUT_FOR_DELIVERY, 5],
  [ShipmentStatus.DELIVERED, 6],
]);

export function otoShipmentStatus(value: string): ShipmentStatus | null {
  return STATUS_MAP.get(value.replace(/[^A-Za-z]/gu, '').toLowerCase()) ?? null;
}

export function nonRegressingShipmentStatus(
  current: ShipmentStatus,
  incoming: ShipmentStatus,
): ShipmentStatus {
  if (current === ShipmentStatus.RETURNED || current === ShipmentStatus.LOST) {
    return current;
  }
  if (current === ShipmentStatus.DELIVERED) {
    return incoming === ShipmentStatus.RETURNED
      ? ShipmentStatus.RETURNED
      : current;
  }
  if (
    incoming === ShipmentStatus.RETURNED ||
    incoming === ShipmentStatus.LOST
  ) {
    return incoming;
  }
  return (PROGRESS.get(incoming) ?? -1) >= (PROGRESS.get(current) ?? -1)
    ? incoming
    : current;
}

/** Ignore callbacks older than the last applied provider update. */
export function isStaleOtoShipmentEvent(
  lastProviderEventAt: Date | null,
  occurredAt: Date | null,
): boolean {
  return (
    lastProviderEventAt !== null &&
    (occurredAt === null ||
      occurredAt.getTime() < lastProviderEventAt.getTime())
  );
}

export function otoOccurredAt(timestamp: string): Date | null {
  const epoch = Number(timestamp);
  if (!Number.isFinite(epoch) || epoch <= 0) return null;
  const date = new Date(epoch);
  return Number.isNaN(date.getTime()) ? null : date;
}
