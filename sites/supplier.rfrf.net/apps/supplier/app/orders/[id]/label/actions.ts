'use server';

import {
  ActorType,
  OrderStatus,
  prisma,
  ShipmentStatus,
  SupplierStatus,
} from '@rafraf/db';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getSessionSupplierId } from '../../../../lib/session';
import {
  ORDER_COMPLIANCE_SELECT,
  orderComplianceLockKey,
  orderComplianceStatus,
} from '@rafraf/shared/workflow/order-compliance';

const INTERNAL_EDITABLE_STATUSES: ShipmentStatus[] = [
  ShipmentStatus.PENDING,
  ShipmentStatus.LABEL_CREATED,
];

function internalTracking(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const nonce = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  return `RFX-${stamp}-${nonce}`;
}

function isInternalProvider(provider: string | null | undefined): boolean {
  return !provider || provider === 'MOCK' || provider === 'RAFRAF_INTERNAL';
}

const SUPPLIER_MANAGED_CARRIERS = new Set([
  'ARAMEX',
  'AUSTRALIA_POST',
  'CANADA_POST',
  'DHL',
  'DPD',
  'EMS',
  'FEDEX',
  'OTHER',
  'ROYAL_MAIL',
  'SF_EXPRESS',
  'SMSA',
  'UPS',
  'USPS',
]);
const TRACKING_PATTERN = /^[A-Z0-9][A-Z0-9._-]{3,79}$/i;

export async function registerSupplierManagedShipment(
  fd: FormData,
): Promise<void> {
  const supplierId = await getSessionSupplierId();
  const orderId = String(fd.get('orderId') ?? '').trim();
  const routeId = String(fd.get('routeId') ?? orderId).slice(0, 100);
  const carrier = String(fd.get('carrier') ?? '')
    .trim()
    .toUpperCase();
  const trackingNumber = String(fd.get('trackingNumber') ?? '').trim();
  if (
    !supplierId ||
    !orderId ||
    !SUPPLIER_MANAGED_CARRIERS.has(carrier) ||
    !TRACKING_PATTERN.test(trackingNumber)
  )
    return;

  try {
    const changed = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderComplianceLockKey(orderId)}))`;
      const supplier = await tx.supplier.findUnique({
        where: { id: supplierId },
        select: { status: true },
      });
      if (!supplier || supplier.status !== SupplierStatus.APPROVED)
        return false;

      const locked = await tx.order.updateMany({
        where: { id: orderId, supplierId, status: OrderStatus.READY_TO_SHIP },
        data: { status: OrderStatus.READY_TO_SHIP },
      });
      if (locked.count !== 1) return false;

      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          ...ORDER_COMPLIANCE_SELECT,
          shipments: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });
      if (!order || order.supplierId !== supplierId) return false;
      if (!orderComplianceStatus(order).cleared) return false;

      const provider = `SUPPLIER_MANAGED_${carrier}`;
      const existing = order.shipments[0];
      if (
        existing?.provider === provider &&
        existing.trackingNumber === trackingNumber &&
        existing.status === ShipmentStatus.LABEL_CREATED
      )
        return true;
      if (
        existing &&
        (!isInternalProvider(existing.provider) ||
          !INTERNAL_EDITABLE_STATUSES.includes(existing.status))
      )
        return false;

      const data = {
        provider,
        trackingNumber,
        status: ShipmentStatus.LABEL_CREATED,
        eventsLog: {
          source: 'supplier_portal',
          kind: 'supplier_managed_declaration',
          carrier,
          verification: 'ADMIN_REQUIRED',
        },
      } as const;

      if (existing) {
        const updated = await tx.shipment.updateMany({
          where: {
            id: existing.id,
            status: existing.status,
            provider: existing.provider,
          },
          data,
        });
        if (updated.count !== 1) return false;
      } else {
        await tx.shipment.create({ data: { orderId: order.id, ...data } });
      }

      await tx.auditLog.create({
        data: {
          actorType: ActorType.SUPPLIER,
          actorId: supplierId,
          action: 'shipment.supplier_managed.declared',
          entityType: 'order',
          entityId: order.id,
          after: {
            provider,
            trackingNumber,
            status: ShipmentStatus.LABEL_CREATED,
            verification: 'ADMIN_REQUIRED',
          },
        },
      });
      return true;
    });
    if (!changed) return;
  } catch (error) {
    console.error('registerSupplierManagedShipment failed:', error);
    return;
  }

  revalidatePath(`/orders/${encodeURIComponent(routeId)}/label`);
  revalidatePath('/shipments');
  revalidatePath('/');
}

export async function createInternalShipmentLabel(fd: FormData): Promise<void> {
  const supplierId = await getSessionSupplierId();
  const orderId = String(fd.get('orderId') ?? '');
  const routeId = String(fd.get('routeId') ?? orderId).slice(0, 100);
  if (!supplierId || !orderId) return;

  let changed = false;

  try {
    changed = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderComplianceLockKey(orderId)}))`;
      // A valid session alone is not enough. Re-read the current supplier state
      // inside the write transaction so a LIMITED/SUSPENDED/REJECTED account
      // cannot create a new logistics reference with an old cookie.
      const supplier = await tx.supplier.findUnique({
        where: { id: supplierId },
        select: { status: true },
      });
      if (!supplier || supplier.status !== SupplierStatus.APPROVED)
        return false;

      // Lock the READY_TO_SHIP order row before reading/creating shipments. This
      // prevents two rapid form submissions from creating duplicate labels.
      const locked = await tx.order.updateMany({
        where: {
          id: orderId,
          supplierId,
          status: OrderStatus.READY_TO_SHIP,
        },
        data: { status: OrderStatus.READY_TO_SHIP },
      });
      if (locked.count !== 1) return false;

      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          ...ORDER_COMPLIANCE_SELECT,
          shipments: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });
      if (!order || order.supplierId !== supplierId) return false;

      if (!orderComplianceStatus(order).cleared) return false;

      const existing = order.shipments[0];
      if (
        existing?.status === ShipmentStatus.LABEL_CREATED &&
        existing.trackingNumber
      ) {
        return true;
      }
      if (
        existing &&
        (!isInternalProvider(existing.provider) ||
          !INTERNAL_EDITABLE_STATUSES.includes(existing.status))
      ) {
        return false;
      }

      const trackingNumber = existing?.trackingNumber ?? internalTracking();
      const provider = 'RAFRAF_INTERNAL';

      if (existing) {
        const updated = await tx.shipment.updateMany({
          where: {
            id: existing.id,
            status: existing.status,
            provider: existing.provider,
          },
          data: {
            provider,
            trackingNumber,
            status: ShipmentStatus.LABEL_CREATED,
            eventsLog: {
              source: 'supplier_portal',
              kind: 'internal_label_preview',
              note: 'مرجع رفرف داخلي مستقل حتى يصدر ملصق الناقل الفعلي',
            },
          },
        });
        if (updated.count !== 1) return false;
      } else {
        await tx.shipment.create({
          data: {
            orderId: order.id,
            provider,
            trackingNumber,
            status: ShipmentStatus.LABEL_CREATED,
            eventsLog: {
              source: 'supplier_portal',
              kind: 'internal_label_preview',
              note: 'مرجع رفرف داخلي مستقل حتى يصدر ملصق الناقل الفعلي',
            },
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorType: ActorType.SUPPLIER,
          actorId: supplierId,
          action: 'shipment.internal_label.created',
          entityType: 'order',
          entityId: order.id,
          after: {
            trackingNumber,
            provider,
            previousShipmentId: existing?.id ?? null,
            previousShipmentStatus: existing?.status ?? null,
          },
        },
      });

      return true;
    });
  } catch (error) {
    console.error('createInternalShipmentLabel failed:', error);
    return;
  }

  if (!changed) return;
  revalidatePath(`/orders/${encodeURIComponent(routeId)}/label`);
  revalidatePath('/shipments');
  revalidatePath('/');
}
