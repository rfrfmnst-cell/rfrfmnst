'use server';

import { ShipmentStatus } from '@rafraf/db';
import { revalidatePath } from 'next/cache';
import { verifyManualShipmentEvent } from '../../../lib/shipping/manual-shipment-verification';
import { requireAdminPermission } from '../../../lib/require-admin-session';

export interface ManualShipmentActionState {
  error?: string;
  success?: string;
}

const SHIPMENT_STATUS_VALUES = new Set<string>(Object.values(ShipmentStatus));

function field(formData: FormData, name: string, max: number): string | null {
  const raw = formData.get(name);
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value && value.length <= max ? value : null;
}

function dateField(formData: FormData, name: string): Date | null {
  const value = field(formData, name, 64);
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function verifyManualCarrierEvent(
  _previous: ManualShipmentActionState,
  formData: FormData,
): Promise<ManualShipmentActionState> {
  void _previous;
  const admin = await requireAdminPermission('SHIPMENT_WRITE');
  const rfqId = field(formData, 'rfqId', 128);
  const orderId = field(formData, 'orderId', 128);
  const shipmentId = field(formData, 'shipmentId', 128);
  const expectedStatus = field(formData, 'expectedStatus', 40);
  const targetStatus = field(formData, 'targetStatus', 40);
  const expectedUpdatedAt = dateField(formData, 'expectedUpdatedAt');
  const occurredAt = dateField(formData, 'occurredAt');
  const carrierEventReference = field(formData, 'carrierEventReference', 200);
  if (
    !rfqId ||
    !orderId ||
    !shipmentId ||
    !expectedStatus ||
    !targetStatus ||
    !SHIPMENT_STATUS_VALUES.has(expectedStatus) ||
    !SHIPMENT_STATUS_VALUES.has(targetStatus) ||
    !expectedUpdatedAt ||
    !occurredAt ||
    !carrierEventReference
  ) {
    return { error: 'بيانات تحقق الشحنة غير مكتملة أو غير صالحة.' };
  }

  const result = await verifyManualShipmentEvent({
    adminId: admin.userId,
    rfqId,
    orderId,
    shipmentId,
    expectedStatus: expectedStatus as ShipmentStatus,
    expectedUpdatedAt,
    targetStatus: targetStatus as ShipmentStatus,
    carrierEventReference,
    occurredAt,
  });
  if (result.outcome === 'APPLIED' || result.outcome === 'REPLAYED') {
    revalidatePath(`/rfq/${encodeURIComponent(rfqId)}`);
    return {
      success:
        result.outcome === 'REPLAYED'
          ? 'هذا الحدث موثق مسبقاً ولم يتكرر التسجيل.'
          : 'تم توثيق حدث الناقل مع سجل تدقيق ذري.',
    };
  }
  const messages: Partial<Record<typeof result.outcome, string>> = {
    PAYMENT_NOT_SECURED: 'الشحن موقوف: لا يوجد دفع حقيقي وقيد ضمان مطابق.',
    CARRIER_NOT_VERIFIABLE:
      'إعلان المورد أو المرجع الداخلي لا يكفي. تحقق من ناقل معروف أولاً.',
    TERMINAL_PROVIDER_PROOF_REQUIRED:
      'التسليم والإرجاع والفقد لا تُثبت يدوياً؛ يلزم حدث موقع من المزود.',
    INVALID_TRANSITION: 'انتقال حالة الشحنة غير مسموح.',
    CONFLICT: 'تغيرت الشحنة أثناء المراجعة. حدّث الصفحة وأعد التحقق.',
    NOT_AVAILABLE: 'الطلب أو الشحنة غير متاحين ضمن هذا الملف.',
    INVALID_INPUT: 'مرجع حدث الناقل غير صالح.',
  };
  return { error: messages[result.outcome] ?? 'تعذر توثيق حدث الناقل.' };
}
