'use server';

import { revalidatePath } from 'next/cache';
import { getSessionSupplierId } from '../../../lib/session';
import { advanceSupplierFulfilment } from '../../../lib/supplier-fulfilment';
import {
  decideSupplierOrder,
  parseSupplierRejectionReason,
} from '../../../lib/supplier-order-confirmation';

function field(fd: FormData, name: string, maxLength = 120): string {
  return String(fd.get(name) ?? '').trim().slice(0, maxLength);
}

function revalidateDecisionPaths(routeId: string): void {
  revalidatePath(`/orders/${encodeURIComponent(routeId)}`);
  revalidatePath('/orders');
  revalidatePath('/shipments');
  revalidatePath('/');
}

export async function acceptSupplierOrder(fd: FormData): Promise<void> {
  const supplierId = await getSessionSupplierId();
  const orderId = field(fd, 'orderId');
  const routeId = field(fd, 'routeId') || orderId;
  if (!supplierId || !orderId) return;

  try {
    await decideSupplierOrder({
      supplierId,
      orderId,
      decision: 'ACCEPT',
    });
  } catch (error) {
    console.error(
      'acceptSupplierOrder failed:',
      error instanceof Error ? error.name : 'UNKNOWN',
    );
    return;
  }

  revalidateDecisionPaths(routeId);
}

export async function rejectSupplierOrder(fd: FormData): Promise<void> {
  const supplierId = await getSessionSupplierId();
  const orderId = field(fd, 'orderId');
  const routeId = field(fd, 'routeId') || orderId;
  const reasonCode = parseSupplierRejectionReason(fd.get('reasonCode'));
  if (!supplierId || !orderId || !reasonCode) return;

  try {
    await decideSupplierOrder({
      supplierId,
      orderId,
      decision: 'REJECT',
      reasonCode,
    });
  } catch (error) {
    console.error(
      'rejectSupplierOrder failed:',
      error instanceof Error ? error.name : 'UNKNOWN',
    );
    return;
  }

  revalidateDecisionPaths(routeId);
}

/**
 * تقدّم خطوة تنفيذ واحدة. الخطوة تصل من النموذج، ومصدر الحقيقة في التحقق منها
 * هو مسار الكتابة لا الواجهة: خطوة غير صالحة أو غير مناسبة للحالة تُرفض هناك.
 */
export async function advanceSupplierOrderFulfilment(
  fd: FormData,
): Promise<void> {
  const supplierId = await getSessionSupplierId();
  const orderId = field(fd, 'orderId');
  const routeId = field(fd, 'routeId') || orderId;
  const step = field(fd, 'step', 40);
  if (!supplierId || !orderId || !step) return;

  try {
    await advanceSupplierFulfilment({ supplierId, orderId, step });
  } catch (error) {
    console.error(
      'advanceSupplierOrderFulfilment failed:',
      error instanceof Error ? error.name : 'UNKNOWN',
    );
    return;
  }

  revalidateDecisionPaths(routeId);
}
