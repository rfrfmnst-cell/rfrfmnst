import { Prisma, prisma, ShipmentStatus } from '@rafraf/db';
import { NextResponse } from 'next/server';
import {
  OtoWebhookVerificationError,
  verifyConfiguredOtoWebhook,
} from '../../../../lib/shipping/oto-webhook';
import {
  isStaleOtoShipmentEvent,
  nonRegressingShipmentStatus,
  otoOccurredAt,
  otoShipmentStatus,
} from '../../../../lib/shipping/oto-status';
import { OTO_APPLIED_ORDER_STATUS_KIND } from '@rafraf/shared/shipping/oto-evidence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  let event;
  try {
    event = verifyConfiguredOtoWebhook(rawBody, request.headers);
  } catch (error) {
    const code =
      error instanceof OtoWebhookVerificationError ? error.code : 'UNKNOWN';
    console.error('[oto-webhook] rejected', { code });
    return NextResponse.json(
      { ok: false },
      { status: code === 'OTO_WEBHOOK_CONFIG_MISSING' ? 503 : 401 },
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { code: event.orderId },
        select: { id: true },
      });
      const storedEvent = await tx.providerWebhookEvent.create({
        data: {
          provider: 'OTO',
          eventId: event.eventId,
          externalOrderCode: event.orderId,
          kind: event.kind,
          occurredAt: otoOccurredAt(event.timestamp),
          payload: event.payload as Prisma.InputJsonValue,
          orderId: order?.id ?? null,
        },
      });
      if (!order || event.kind !== 'ORDER_STATUS') {
        return { applied: false };
      }
      const incoming = otoShipmentStatus(event.status);
      if (!incoming) return { applied: false };

      // Serialize callbacks for this order before reading the last applied event.
      // Otherwise concurrent old/new events could both read the same stale row.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`oto-shipment:${order.id}`}))`;
      const existing = await tx.shipment.findFirst({
        where: { orderId: order.id, provider: 'OTO' },
        orderBy: { createdAt: 'desc' },
      });
      const occurredAt = otoOccurredAt(event.timestamp);
      if (!existing) {
        await tx.shipment.create({
          data: {
            orderId: order.id,
            provider: 'OTO',
            idempotencyKey: `oto:${order.id}`,
            externalOrderId: event.orderId,
            trackingNumber: event.trackingNumber,
            labelUrl: event.labelUrl,
            status: incoming,
            shippedAt:
              incoming === ShipmentStatus.PICKED_UP ||
              incoming === ShipmentStatus.IN_TRANSIT ||
              incoming === ShipmentStatus.OUT_FOR_DELIVERY ||
              incoming === ShipmentStatus.DELIVERED
                ? occurredAt
                : null,
            deliveredAt:
              incoming === ShipmentStatus.DELIVERED ? occurredAt : null,
            lastProviderEventAt: occurredAt,
          },
        });
        await tx.providerWebhookEvent.update({
          where: { id: storedEvent.id },
          data: { kind: OTO_APPLIED_ORDER_STATUS_KIND },
        });
        return { applied: true };
      }

      // Keep the signed event for audit, but never let an older callback
      // overwrite a later status, tracking reference, AWB, or event time.
      if (isStaleOtoShipmentEvent(existing.lastProviderEventAt, occurredAt)) {
        return { applied: false };
      }

      const status = nonRegressingShipmentStatus(existing.status, incoming);
      await tx.shipment.update({
        where: { id: existing.id },
        data: {
          status,
          trackingNumber: event.trackingNumber ?? existing.trackingNumber,
          labelUrl: event.labelUrl ?? existing.labelUrl,
          shippedAt:
            existing.shippedAt ??
            (status === ShipmentStatus.PICKED_UP ||
            status === ShipmentStatus.IN_TRANSIT ||
            status === ShipmentStatus.OUT_FOR_DELIVERY ||
            status === ShipmentStatus.DELIVERED
              ? occurredAt
              : null),
          deliveredAt:
            existing.deliveredAt ??
            (status === ShipmentStatus.DELIVERED ? occurredAt : null),
          lastProviderEventAt: occurredAt ?? existing.lastProviderEventAt,
        },
      });
      await tx.providerWebhookEvent.update({
        where: { id: storedEvent.id },
        data: { kind: OTO_APPLIED_ORDER_STATUS_KIND },
      });
      return { applied: true };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return NextResponse.json({ ok: true, replayed: true });
    }
    console.error('[oto-webhook] persistence failed', {
      code: 'OTO_WEBHOOK_PERSISTENCE_FAILED',
    });
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
