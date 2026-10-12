import {
  ActorType,
  OrderStatus,
  prisma,
  ShipmentStatus,
  SupplierStatus,
} from '@rafraf/db';
import {
  assertOrderTransition,
  type OrderState,
} from '@rafraf/shared/workflow/order-state';
import { carrierShipmentSupportsOrderStep } from '@rafraf/shared/workflow/shipment-proof';
import {
  ORDER_COMPLIANCE_SELECT,
  orderComplianceLockKey,
  orderComplianceStatus,
} from '@rafraf/shared/workflow/order-compliance';

/**
 * The fulfilment leg visible to the supplier, from a fitment-cleared order to
 * a delivered one. The supplier may prepare the parcel, but every shipping
 * transition is accepted only after the external carrier confirms it.
 *
 * The leg stops once delivery opens the complaint window. Everything past that
 * — closing the order and releasing escrow to the supplier — settles money
 * rather than moving goods, so it belongs to an operations-owned flow with its
 * own authority, not to the tenant being paid.
 */
export const SUPPLIER_FULFILMENT_STEPS = {
  READY_TO_SHIP: {
    from: OrderStatus.FITMENT_VERIFIED,
    to: OrderStatus.READY_TO_SHIP,
    note: 'جهّز المورد القطعة للشحن',
    action: 'order.supplier.ready_to_ship',
    shipment: null,
    requiresLabel: false,
  },
  SHIPPED: {
    from: OrderStatus.READY_TO_SHIP,
    to: OrderStatus.SHIPPED,
    note: 'سلّم المورد الشحنة إلى شركة الشحن',
    action: 'order.supplier.shipped',
    shipment: ShipmentStatus.PICKED_UP,
    requiresLabel: true,
  },
  IN_TRANSIT: {
    from: OrderStatus.SHIPPED,
    to: OrderStatus.IN_TRANSIT,
    note: 'الشحنة في الطريق',
    action: 'order.supplier.in_transit',
    shipment: ShipmentStatus.IN_TRANSIT,
    requiresLabel: true,
  },
  OUT_FOR_DELIVERY: {
    from: OrderStatus.IN_TRANSIT,
    to: OrderStatus.OUT_FOR_DELIVERY,
    note: 'الشحنة خرجت للتسليم',
    action: 'order.supplier.out_for_delivery',
    shipment: ShipmentStatus.OUT_FOR_DELIVERY,
    requiresLabel: true,
  },
  DELIVERED: {
    from: OrderStatus.OUT_FOR_DELIVERY,
    to: OrderStatus.DELIVERED,
    note: 'تم تسليم الشحنة إلى العميل',
    action: 'order.supplier.delivered',
    shipment: ShipmentStatus.DELIVERED,
    requiresLabel: true,
  },
} as const;

/**
 * التسليم يفتح نافذة الشكوى في المعاملة نفسها.
 *
 * لو تُركت خطوةً منفصلة لبقي كل طلب مسلَّم في `DELIVERED` بلا ساعة تعمل، وهي
 * الحالة نفسها التي كانت تحبس المال قبل هذه الساق: مسلَّم، ولا أحد يملك تحريكه.
 */
const OPENS_COMPLAINT_WINDOW: SupplierFulfilmentStep = 'DELIVERED';

export type SupplierFulfilmentStep = keyof typeof SUPPLIER_FULFILMENT_STEPS;

export type SupplierFulfilmentOutcome =
  | 'APPLIED'
  | 'REPLAYED'
  | 'INVALID_STEP'
  | 'NOT_AVAILABLE'
  | 'NOT_ACTIONABLE'
  | 'CARRIER_CONFIRMATION_REQUIRED'
  | 'COMPLIANCE_REQUIRED'
  | 'SUPPLIER_NOT_APPROVED';

export interface SupplierFulfilmentInput {
  supplierId: string;
  orderId: string;
  step: string;
}

export interface SupplierFulfilmentResult {
  outcome: SupplierFulfilmentOutcome;
  status?: OrderStatus;
}

export function parseSupplierFulfilmentStep(
  value: unknown,
): SupplierFulfilmentStep | null {
  if (typeof value !== 'string') return null;
  return Object.hasOwn(SUPPLIER_FULFILMENT_STEPS, value)
    ? (value as SupplierFulfilmentStep)
    : null;
}

/**
 * The step a supplier may take on an order in this status, or null when the
 * order is waiting on someone else. Callers use it to render one action rather
 * than guessing, so the UI can never offer a step the write path will reject.
 */
export function nextSupplierFulfilmentStep(
  status: OrderStatus,
): SupplierFulfilmentStep | null {
  for (const [step, spec] of Object.entries(SUPPLIER_FULFILMENT_STEPS)) {
    if (spec.from === status) return step as SupplierFulfilmentStep;
  }
  return null;
}

/**
 * Advances one fulfilment step behind a tenant-scoped advisory lock and a
 * compare-and-swap on the source status, so two rapid submissions collapse into
 * a single transition instead of skipping a step.
 */
export async function advanceSupplierFulfilment(
  input: SupplierFulfilmentInput,
  client: typeof prisma = prisma,
): Promise<SupplierFulfilmentResult> {
  const step = parseSupplierFulfilmentStep(input.step);
  if (!step) return { outcome: 'INVALID_STEP' };

  const spec = SUPPLIER_FULFILMENT_STEPS[step];

  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderComplianceLockKey(input.orderId)}))`;

    // Re-read tenant standing inside the write transaction: a session minted
    // while the supplier was APPROVED must not keep moving goods after a
    // suspension.
    const supplier = await tx.supplier.findUnique({
      where: { id: input.supplierId },
      select: { status: true },
    });
    if (!supplier || supplier.status !== SupplierStatus.APPROVED) {
      return { outcome: 'SUPPLIER_NOT_APPROVED' };
    }

    // Ownership is enforced in both the read and the CAS below. NOT_AVAILABLE
    // avoids confirming that another tenant's order exists.
    const order = await tx.order.findFirst({
      where: { id: input.orderId, supplierId: input.supplierId },
      select: { id: true, status: true, ...ORDER_COMPLIANCE_SELECT },
    });
    if (!order) return { outcome: 'NOT_AVAILABLE' };
    if (order.status === spec.to) {
      return { outcome: 'REPLAYED', status: spec.to };
    }
    // Delivery lands on COMPLAINT_WINDOW rather than DELIVERED, so a repeated
    // submission has to be recognised by where it actually settled.
    if (
      step === OPENS_COMPLAINT_WINDOW &&
      order.status === OrderStatus.COMPLAINT_WINDOW
    ) {
      return { outcome: 'REPLAYED', status: OrderStatus.COMPLAINT_WINDOW };
    }
    if (order.status !== spec.from) {
      return { outcome: 'NOT_ACTIONABLE', status: order.status };
    }
    if (
      (step === 'READY_TO_SHIP' || step === 'SHIPPED') &&
      !orderComplianceStatus(order).cleared
    ) {
      return { outcome: 'COMPLIANCE_REQUIRED', status: order.status };
    }

    let carrierShipment:
      | {
          provider: string;
          trackingNumber: string | null;
          status: ShipmentStatus;
        }
      | undefined;
    if (spec.requiresLabel) {
      const shipments = await tx.shipment.findMany({
        where: { orderId: order.id },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: { provider: true, trackingNumber: true, status: true },
      });
      carrierShipment = shipments.find((shipment) =>
        carrierShipmentSupportsOrderStep(step, shipment),
      );
      if (!carrierShipment) {
        return { outcome: 'CARRIER_CONFIRMATION_REQUIRED' };
      }
    }

    assertOrderTransition(spec.from as OrderState, spec.to as OrderState);

    const moved = await tx.order.updateMany({
      where: {
        id: order.id,
        supplierId: input.supplierId,
        status: spec.from,
      },
      data: { status: spec.to },
    });

    if (moved.count !== 1) {
      const latest = await tx.order.findFirst({
        where: { id: input.orderId, supplierId: input.supplierId },
        select: { status: true },
      });
      if (latest?.status === spec.to) {
        return { outcome: 'REPLAYED', status: spec.to };
      }
      return { outcome: 'NOT_ACTIONABLE', status: latest?.status };
    }

    let finalStatus: OrderStatus = spec.to;
    if (step === OPENS_COMPLAINT_WINDOW) {
      const deliveredAt = new Date();
      assertOrderTransition('DELIVERED', 'COMPLAINT_WINDOW');
      const opened = await tx.order.updateMany({
        where: { id: order.id, status: OrderStatus.DELIVERED },
        data: {
          status: OrderStatus.COMPLAINT_WINDOW,
          deliveredAt,
        },
      });
      if (opened.count !== 1) {
        throw new Error('Delivered order could not open the complaint window');
      }
      finalStatus = OrderStatus.COMPLAINT_WINDOW;

      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          fromStatus: OrderStatus.DELIVERED,
          toStatus: OrderStatus.COMPLAINT_WINDOW,
          actorType: ActorType.SUPPLIER,
          actorId: input.supplierId,
          note: 'بدأت نافذة الشكوى من لحظة التسليم',
        },
      });
    }

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        fromStatus: spec.from,
        toStatus: spec.to,
        actorType: ActorType.SUPPLIER,
        actorId: input.supplierId,
        note: spec.note,
      },
    });

    // Escrow is untouched all through this leg: goods moving is not money
    // moving, and recording otherwise would misstate the ledger.
    await tx.auditLog.create({
      data: {
        actorId: input.supplierId,
        actorType: ActorType.SUPPLIER,
        action: spec.action,
        entityType: 'order',
        entityId: order.id,
        before: { status: spec.from },
        after: {
          status: finalStatus,
          step,
          shipmentStatus: spec.shipment,
          carrierProvider: carrierShipment?.provider ?? null,
          escrowAction: 'NONE',
        },
      },
    });

    return { outcome: 'APPLIED', status: finalStatus };
  });
}
