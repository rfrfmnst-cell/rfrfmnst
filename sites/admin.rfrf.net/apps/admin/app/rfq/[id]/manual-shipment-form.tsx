'use client';

import type { ShipmentStatus } from '@rafraf/db';
import { useActionState } from 'react';
import {
  verifyManualCarrierEvent,
  type ManualShipmentActionState,
} from './manual-shipment-actions';

const INITIAL: ManualShipmentActionState = {};

const NEXT_STATUSES: Partial<
  Record<ShipmentStatus, readonly ShipmentStatus[]>
> = {
  LABEL_CREATED: ['PICKED_UP'],
  PICKED_UP: ['IN_TRANSIT'],
  IN_TRANSIT: ['CUSTOMS', 'OUT_FOR_DELIVERY'],
  CUSTOMS: ['OUT_FOR_DELIVERY'],
};

const LABEL: Partial<Record<ShipmentStatus, string>> = {
  PICKED_UP: 'استلم الناقل الشحنة',
  IN_TRANSIT: 'الشحنة في الطريق',
  CUSTOMS: 'دخلت التخليص الجمركي',
  OUT_FOR_DELIVERY: 'خرجت للتوصيل',
};

export function ManualShipmentForm(props: {
  rfqId: string;
  orderId: string;
  shipment: {
    id: string;
    provider: string;
    trackingNumber: string | null;
    status: ShipmentStatus;
    updatedAt: Date;
  };
}) {
  const [state, action, pending] = useActionState(
    verifyManualCarrierEvent,
    INITIAL,
  );
  const next = NEXT_STATUSES[props.shipment.status] ?? [];
  if (!next.length) return null;
  return (
    <form action={action} className="send-form">
      <strong>مراجعة حدث ناقل خارجي</strong>
      <span className="hint">
        {props.shipment.provider} ·{' '}
        {props.shipment.trackingNumber ?? 'بلا تتبع'}
      </span>
      <input type="hidden" name="rfqId" value={props.rfqId} />
      <input type="hidden" name="orderId" value={props.orderId} />
      <input type="hidden" name="shipmentId" value={props.shipment.id} />
      <input
        type="hidden"
        name="expectedStatus"
        value={props.shipment.status}
      />
      <input
        type="hidden"
        name="expectedUpdatedAt"
        value={props.shipment.updatedAt.toISOString()}
      />
      <label>
        الحدث الذي تحقق منه المشغّل
        <select name="targetStatus" required defaultValue="">
          <option value="" disabled>
            اختر الحدث
          </option>
          {next.map((status) => (
            <option key={status} value={status}>
              {LABEL[status] ?? status}
            </option>
          ))}
        </select>
      </label>
      <label>
        مرجع الحدث من نظام الناقل
        <input
          name="carrierEventReference"
          dir="ltr"
          required
          minLength={6}
          maxLength={200}
          pattern="[A-Za-z0-9][A-Za-z0-9._:/-]{5,199}"
          autoComplete="off"
        />
      </label>
      <label>
        وقت الحدث لدى الناقل
        <input name="occurredAt" type="datetime-local" required />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? 'جارٍ التوثيق…' : 'توثيق الحدث بعد التحقق الخارجي'}
      </button>
      <span className="hint">
        لا يمكن إثبات التسليم أو الإرجاع أو الفقد من هذا النموذج؛ يلزم Webhook
        موقع من المزود.
      </span>
      {state.error ? <span className="hint">{state.error}</span> : null}
      {state.success ? <span className="hint">{state.success}</span> : null}
    </form>
  );
}
