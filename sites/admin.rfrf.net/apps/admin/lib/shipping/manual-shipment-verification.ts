import {
  ActorType,
  EscrowEntryType,
  OrderStatus,
  PaymentStatus,
  Prisma,
  ShipmentStatus,
  prisma,
} from '@rafraf/db';
import { EDFAPAY_PAYMENT_PROVIDER } from '@rafraf/shared/payments/manual-payment-policy';
import { canTransitionShipment } from '@rafraf/shared/workflow/shipment-state';

const MANUAL_SHIPMENT_ORDER_STATUSES = [
  OrderStatus.READY_TO_SHIP,
  OrderStatus.SHIPPED,
  OrderStatus.IN_TRANSIT,
  OrderStatus.CUSTOMS_REVIEW,
  OrderStatus.OUT_FOR_DELIVERY,
] as const;

const MANUAL_TARGET_STATUSES = new Set<ShipmentStatus>([
  ShipmentStatus.PICKED_UP,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.CUSTOMS,
  ShipmentStatus.OUT_FOR_DELIVERY,
]);

const TERMINAL_PROVIDER_STATUSES = new Set<string>([
  ShipmentStatus.DELIVERED,
  ShipmentStatus.RETURNED,
  ShipmentStatus.LOST,
]);

const VERIFIABLE_CARRIERS = new Set([
  'ARAMEX',
  'AUSTRALIA_POST',
  'CANADA_POST',
  'DHL',
  'DPD',
  'EMS',
  'FEDEX',
  'ROYAL_MAIL',
  'SF_EXPRESS',
  'SMSA',
  'UPS',
  'USPS',
]);

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const EVENT_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{5,199}$/u;
const PROVIDER_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{5,199}$/u;

export type ManualShipmentVerificationOutcome =
  | 'APPLIED'
  | 'REPLAYED'
  | 'INVALID_INPUT'
  | 'TERMINAL_PROVIDER_PROOF_REQUIRED'
  | 'NOT_AVAILABLE'
  | 'PAYMENT_NOT_SECURED'
  | 'CARRIER_NOT_VERIFIABLE'
  | 'INVALID_TRANSITION'
  | 'CONFLICT';

export interface ManualShipmentVerificationInput {
  adminId: string;
  rfqId: string;
  orderId: string;
  shipmentId: string;
  expectedStatus: ShipmentStatus;
  expectedUpdatedAt: Date;
  targetStatus: ShipmentStatus | string;
  carrierEventReference: string;
  occurredAt: Date;
}

export interface ManualShipmentVerificationResult {
  outcome: ManualShipmentVerificationOutcome;
  status?: ShipmentStatus;
}

function record(
  value: Prisma.JsonValue | null,
): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function verifiedCarrier(
  provider: string,
  eventsLog: Prisma.JsonValue | null,
): string | null {
  const normalized = provider.trim().toUpperCase();
  if (
    normalized === 'MOCK' ||
    normalized === 'RAFRAF_INTERNAL' ||
    normalized === 'OTO'
  ) {
    return null;
  }
  if (normalized.startsWith('SUPPLIER_MANAGED_')) {
    const declared = normalized.slice('SUPPLIER_MANAGED_'.length);
    return VERIFIABLE_CARRIERS.has(declared) ? declared : null;
  }
  const previous = record(eventsLog);
  return VERIFIABLE_CARRIERS.has(normalized) &&
    previous?.verification === 'ADMIN_VERIFIED'
    ? normalized
    : null;
}

function moneyCents(value: unknown): bigint | null {
  const normalized = String(value);
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/u.exec(normalized);
  if (!match?.[1]) return null;
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
}

function carrierEventId(
  shipmentId: string,
  provider: string,
  reference: string,
): string {
  return `manual-carrier:${shipmentId}:${provider}:${reference}`;
}

export async function verifyManualShipmentEvent(
  input: ManualShipmentVerificationInput,
  client: typeof prisma = prisma,
): Promise<ManualShipmentVerificationResult> {
  if (TERMINAL_PROVIDER_STATUSES.has(input.targetStatus)) {
    return { outcome: 'TERMINAL_PROVIDER_PROOF_REQUIRED' };
  }
  if (
    !ID_PATTERN.test(input.adminId) ||
    !ID_PATTERN.test(input.rfqId) ||
    !ID_PATTERN.test(input.orderId) ||
    !ID_PATTERN.test(input.shipmentId) ||
    !MANUAL_TARGET_STATUSES.has(input.targetStatus as ShipmentStatus) ||
    !EVENT_REFERENCE_PATTERN.test(input.carrierEventReference) ||
    Number.isNaN(input.expectedUpdatedAt.getTime()) ||
    Number.isNaN(input.occurredAt.getTime())
  ) {
    return { outcome: 'INVALID_INPUT' };
  }

  const targetStatus = input.targetStatus as ShipmentStatus;
  return client.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order-financial-resolution:${input.orderId}`}))`;
      const order = await tx.order.findFirst({
        where: {
          id: input.orderId,
          rfqId: input.rfqId,
          status: { in: [...MANUAL_SHIPMENT_ORDER_STATUSES] },
        },
        select: {
          id: true,
          status: true,
          totalAmount: true,
          currency: true,
          payments: {
            where: {
              status: { in: [PaymentStatus.CAPTURED, PaymentStatus.HELD] },
            },
            select: {
              id: true,
              provider: true,
              amount: true,
              currency: true,
              externalRef: true,
              providerOrderCode: true,
              refunds: { select: { id: true }, take: 1 },
            },
            take: 2,
          },
          escrow: {
            where: { entryType: EscrowEntryType.HOLD },
            select: { paymentId: true, amount: true, currency: true },
            take: 2,
          },
        },
      });
      if (!order) return { outcome: 'NOT_AVAILABLE' } as const;

      const orderCents = moneyCents(order.totalAmount);
      const payment = order.payments.length === 1 ? order.payments[0] : null;
      const hold = order.escrow.length === 1 ? order.escrow[0] : null;
      const paymentCents = payment ? moneyCents(payment.amount) : null;
      const holdCents = hold ? moneyCents(hold.amount) : null;
      const secured = Boolean(
        orderCents !== null &&
        orderCents > 0n &&
        payment &&
        hold &&
        payment.refunds.length === 0 &&
        payment.provider === EDFAPAY_PAYMENT_PROVIDER &&
        payment.externalRef &&
        PROVIDER_REFERENCE_PATTERN.test(payment.externalRef.trim()) &&
        payment.providerOrderCode &&
        PROVIDER_REFERENCE_PATTERN.test(payment.providerOrderCode.trim()) &&
        payment.currency === order.currency &&
        hold.currency === order.currency &&
        hold.paymentId === payment.id &&
        paymentCents === orderCents &&
        holdCents === orderCents,
      );
      if (!secured) {
        return { outcome: 'PAYMENT_NOT_SECURED' } as const;
      }

      const shipment = await tx.shipment.findFirst({
        where: { id: input.shipmentId, orderId: order.id },
        select: {
          id: true,
          orderId: true,
          provider: true,
          trackingNumber: true,
          status: true,
          shippedAt: true,
          updatedAt: true,
          eventsLog: true,
        },
      });
      if (!shipment) return { outcome: 'NOT_AVAILABLE' } as const;

      const provider = verifiedCarrier(shipment.provider, shipment.eventsLog);
      if (!provider || !shipment.trackingNumber) {
        return { outcome: 'CARRIER_NOT_VERIFIABLE' } as const;
      }
      const durableEventId = carrierEventId(
        shipment.id,
        provider,
        input.carrierEventReference,
      );
      const existingEvent = await tx.providerWebhookEvent.findUnique({
        where: { eventId: durableEventId },
        select: { id: true },
      });
      if (existingEvent) {
        return { outcome: 'REPLAYED', status: shipment.status } as const;
      }
      if (
        shipment.status !== input.expectedStatus ||
        shipment.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
      ) {
        return { outcome: 'CONFLICT' } as const;
      }
      if (!canTransitionShipment(shipment.status, targetStatus)) {
        return { outcome: 'INVALID_TRANSITION' } as const;
      }

      const eventsLog = {
        source: 'admin_carrier_verification',
        verification: 'ADMIN_VERIFIED',
        carrier: provider,
        carrierEventReference: input.carrierEventReference,
        occurredAt: input.occurredAt.toISOString(),
      } as const;
      const moved = await tx.shipment.updateMany({
        where: {
          id: shipment.id,
          orderId: order.id,
          status: input.expectedStatus,
          updatedAt: input.expectedUpdatedAt,
        },
        data: {
          provider,
          status: targetStatus,
          shippedAt:
            shipment.shippedAt ??
            (targetStatus === ShipmentStatus.PICKED_UP
              ? input.occurredAt
              : undefined),
          lastProviderEventAt: input.occurredAt,
          eventsLog,
        },
      });
      if (moved.count !== 1) return { outcome: 'CONFLICT' } as const;

      await tx.providerWebhookEvent.create({
        data: {
          provider,
          eventId: durableEventId,
          externalOrderCode: order.id,
          kind: 'MANUAL_CARRIER_EVENT_APPLIED',
          occurredAt: input.occurredAt,
          orderId: order.id,
          payload: {
            shipmentId: shipment.id,
            carrierEventReference: input.carrierEventReference,
            targetStatus,
          },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: input.adminId,
          actorType: ActorType.ADMIN,
          action: 'shipment.carrier_event.verified',
          entityType: 'shipment',
          entityId: shipment.id,
          before: {
            provider: shipment.provider,
            status: shipment.status,
            updatedAt: shipment.updatedAt.toISOString(),
          },
          after: {
            provider,
            status: targetStatus,
            carrierEventReference: input.carrierEventReference,
            occurredAt: input.occurredAt.toISOString(),
            orderId: order.id,
            rfqId: input.rfqId,
          },
        },
      });
      return { outcome: 'APPLIED', status: targetStatus } as const;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}
