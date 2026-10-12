'use server';

import {
  ActorType,
  OrderStatus,
  Prisma,
  ShipmentStatus,
  prisma,
} from '@rafraf/db';
import { revalidatePath } from 'next/cache';
import { otoClaimDefinitivelyRejected } from '@rafraf/shared/workflow/oto-claim';
import {
  OtoOperationalError,
  configuredOtoOperationalAdapter,
} from '../../../lib/shipping/oto-operational';
import { requireAdminPermission } from '../../../lib/require-admin-session';
import {
  COMPLIANCE_PART_SELECT,
  ORDER_COMPLIANCE_SELECT,
  orderComplianceLockKey,
  orderComplianceStatus,
} from '@rafraf/shared/workflow/order-compliance';

export interface OtoShipmentActionState {
  error?: string;
  success?: string;
}

type AddressSnapshot = {
  name: string;
  phone: string;
  email?: string;
  address: string;
  district?: string;
  city: string;
  country: string;
  postcode?: string;
};

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function addressSnapshot(value: Prisma.JsonValue): AddressSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, Prisma.JsonValue>;
  const name = text(record.name, 160);
  const phone = text(record.phone, 32);
  const address = text(record.address, 500);
  const city = text(record.city, 100);
  const country = text(record.country, 3)?.toUpperCase();
  if (!name || !phone || !address || !city || country !== 'SA') return null;
  const email = text(record.email, 254) ?? undefined;
  const district = text(record.district, 160) ?? undefined;
  const postcode = text(record.postcode, 32) ?? undefined;
  return {
    name,
    phone,
    ...(email ? { email } : {}),
    address,
    ...(district ? { district } : {}),
    city,
    country,
    ...(postcode ? { postcode } : {}),
  };
}

function positiveNumber(
  value: FormDataEntryValue | null,
  max: number,
): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= max ? parsed : null;
}

function positiveInteger(
  value: FormDataEntryValue | null,
  max: number,
): number | null {
  const parsed = positiveNumber(value, max);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function publicError(error: unknown, definitelyRejected: boolean): string {
  if (error instanceof OtoOperationalError) {
    if (definitelyRejected && error.code === 'OTO_OPERATIONAL_AUTH_FAILED') {
      return 'رفض OTO اعتماد الخادم. لم تُنشأ شحنة.';
    }
    if (
      definitelyRejected &&
      error.code === 'OTO_OPERATIONAL_REQUEST_INVALID'
    ) {
      return 'بيانات الشحنة غير مكتملة أو غير صالحة.';
    }
    if (error.retryable) {
      return 'حالة طلب OTO غير مؤكدة مؤقتاً. أوقفنا إعادة الإرسال لمنع شحنة مكررة؛ استخدم المصالحة.';
    }
  }
  return 'تعذر إنشاء شحنة OTO. لم تُسجّل الشحنة كمكتملة.';
}

export async function createOtoShipment(
  _previous: OtoShipmentActionState,
  formData: FormData,
): Promise<OtoShipmentActionState> {
  void _previous;
  const admin = await requireAdminPermission('SHIPMENT_WRITE');
  const orderId = text(formData.get('orderId'), 100);
  const rfqId = text(formData.get('rfqId'), 100);
  const deliveryOptionId = positiveInteger(
    formData.get('deliveryOptionId'),
    9_999_999_999,
  );
  const packageCount = positiveInteger(formData.get('packageCount'), 1_000);
  const packageWeight = positiveNumber(formData.get('packageWeight'), 99_999);
  if (
    !orderId ||
    !rfqId ||
    !deliveryOptionId ||
    !packageCount ||
    !packageWeight
  ) {
    return { error: 'أدخل خيار الناقل وعدد الطرود والوزن بقيم صحيحة.' };
  }
  const adapter = configuredOtoOperationalAdapter();
  const pickupLocationCode = text(process.env.OTO_PICKUP_LOCATION_CODE, 100);
  if (!adapter || !pickupLocationCode) {
    return { error: 'موصل OTO التشغيلي أو موقع الاستلام غير مكتمل.' };
  }

  const claimed = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderComplianceLockKey(orderId)}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`oto-shipment:${orderId}`}))`;
    const order = await tx.order.findFirst({
      where: { id: orderId, rfqId, status: OrderStatus.READY_TO_SHIP },
      select: {
        id: true,
        code: true,
        totalAmount: true,
        currency: true,
        shippingAddress: true,
        complianceCases: ORDER_COMPLIANCE_SELECT.complianceCases,
        quote: {
          select: {
            id: true,
            finalPrice: true,
            part: { select: COMPLIANCE_PART_SELECT },
            rfqItem: {
              select: {
                id: true,
                freeTextAr: true,
                oemNumber: true,
                quantity: true,
                part: { select: { nameAr: true, ...COMPLIANCE_PART_SELECT } },
              },
            },
          },
        },
        shipments: {
          where: { provider: 'OTO' },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!order || order.currency !== 'SAR') return null;
    if (!orderComplianceStatus(order).cleared) return null;
    const recipient = addressSnapshot(order.shippingAddress);
    if (!recipient) return null;
    const existing =
      order.shipments.find((item) => !otoClaimDefinitivelyRejected(item)) ??
      order.shipments[0];
    if (existing && !otoClaimDefinitivelyRejected(existing)) {
      return { replayed: true as const, order, recipient, shipment: existing };
    }
    const data = {
      orderId: order.id,
      provider: 'OTO',
      idempotencyKey: `oto:${order.id}`,
      status: ShipmentStatus.PENDING,
      eventsLog: {
        stage: 'OTO_ORDER_SUBMITTING',
        deliveryOptionId,
        actorId: admin.userId,
      },
    };
    // Reuse the same idempotency key only after a proven pre-order rejection.
    const shipment = existing
      ? await tx.shipment.update({ where: { id: existing.id }, data })
      : await tx.shipment.create({ data });
    return { replayed: false as const, order, recipient, shipment };
  });

  if (!claimed) {
    return {
      error:
        'الطلب يحتاج جاهزية الشحن واعتماد الامتثال وعنواناً صالحاً بالدفع.',
    };
  }
  if (claimed.replayed) {
    return { success: 'الشحنة موجودة مسبقاً ولم يُرسل طلب جديد إلى OTO.' };
  }

  const { order, recipient, shipment } = claimed;
  const item = order.quote.rfqItem;
  let externalOrderId = shipment.externalOrderId;
  try {
    if (!externalOrderId) {
      const created = await adapter.createOrder({
        orderId: order.code,
        pickupLocationCode,
        deliveryOptionId,
        amount: Number(order.totalAmount),
        currency: 'SAR',
        packageCount,
        packageWeight,
        customer: {
          name: recipient.name,
          mobile: recipient.phone,
          ...(recipient.email ? { email: recipient.email } : {}),
          address: recipient.address,
          ...(recipient.district ? { district: recipient.district } : {}),
          city: recipient.city,
          country: recipient.country,
          ...(recipient.postcode ? { postcode: recipient.postcode } : {}),
          refID: order.id,
        },
        items: [
          {
            name: item.part?.nameAr ?? item.freeTextAr ?? 'قطعة غيار',
            price: Number(order.quote.finalPrice),
            rowTotal: Number(order.quote.finalPrice),
            quantity: item.quantity,
            sku: item.oemNumber ?? item.id,
          },
        ],
      });
      externalOrderId = created.otoId;
      const persistedOrder = await prisma.shipment.updateMany({
        where: { id: shipment.id, externalOrderId: null },
        data: {
          externalOrderId,
          eventsLog: {
            stage: 'OTO_ORDER_CREATED',
            deliveryOptionId,
            actorId: admin.userId,
          },
        },
      });
      if (persistedOrder.count !== 1) {
        throw new Error('OTO_ORDER_PERSISTENCE_CONFLICT');
      }
    }

    await adapter.createShipment(order.code, deliveryOptionId);
    await prisma.$transaction([
      prisma.shipment.update({
        where: { id: shipment.id },
        data: {
          externalOrderId,
          eventsLog: {
            stage: 'OTO_SHIPMENT_REQUESTED',
            deliveryOptionId,
            actorId: admin.userId,
          },
        },
      }),
      prisma.auditLog.create({
        data: {
          actorType: ActorType.ADMIN,
          actorId: admin.userId,
          action: 'shipment.oto.requested',
          entityType: 'order',
          entityId: order.id,
          after: {
            provider: 'OTO',
            shipmentId: shipment.id,
            deliveryOptionId,
          },
        },
      }),
    ]);
    revalidatePath(`/rfq/${encodeURIComponent(rfqId)}`);
    return {
      success:
        'قُبل طلب الشحنة لدى OTO. ستثبت البوليصة والتتبع عبر Webhook الموقع.',
    };
  } catch (error) {
    const code = error instanceof OtoOperationalError ? error.code : 'UNKNOWN';
    const definitelyRejected =
      !externalOrderId &&
      error instanceof OtoOperationalError &&
      !error.retryable &&
      [
        'OTO_OPERATIONAL_AUTH_FAILED',
        'OTO_OPERATIONAL_REQUEST_INVALID',
      ].includes(code);
    await prisma.shipment.updateMany({
      where: {
        id: shipment.id,
        status: ShipmentStatus.PENDING,
        ...(definitelyRejected
          ? {
              externalOrderId: null,
              trackingNumber: null,
              labelUrl: null,
              shippedAt: null,
              lastProviderEventAt: null,
            }
          : {}),
      },
      data: {
        eventsLog: {
          stage: definitelyRejected
            ? 'OTO_ORDER_REJECTED'
            : 'OTO_SUBMISSION_UNCERTAIN',
          code,
          deliveryOptionId,
          actorId: admin.userId,
        },
      },
    });
    console.error('[oto-shipment] request failed', { code });
    revalidatePath(`/rfq/${encodeURIComponent(rfqId)}`);
    return { error: publicError(error, definitelyRejected) };
  }
}
