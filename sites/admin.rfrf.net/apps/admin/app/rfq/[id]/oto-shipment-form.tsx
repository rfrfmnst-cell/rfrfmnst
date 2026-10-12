'use client';

import { useActionState } from 'react';
import {
  createOtoShipment,
  type OtoShipmentActionState,
} from './oto-shipment-actions';

const INITIAL: OtoShipmentActionState = {};

export function OtoShipmentForm(props: { orderId: string; rfqId: string }) {
  const [state, action, pending] = useActionState(createOtoShipment, INITIAL);
  return (
    <form action={action} className="send-form">
      <input type="hidden" name="orderId" value={props.orderId} />
      <input type="hidden" name="rfqId" value={props.rfqId} />
      <label>
        معرف خيار الناقل من نتيجة OTO
        <input name="deliveryOptionId" inputMode="numeric" required />
      </label>
      <label>
        عدد الطرود
        <input
          name="packageCount"
          type="number"
          min="1"
          max="1000"
          defaultValue="1"
          required
        />
      </label>
      <label>
        الوزن بالكيلو
        <input
          name="packageWeight"
          type="number"
          min="0.01"
          max="99999"
          step="0.01"
          required
        />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? 'جارٍ الحجز لدى OTO…' : 'إنشاء شحنة OTO وبوليصتها'}
      </button>
      {state.error ? <span className="hint">{state.error}</span> : null}
      {state.success ? <span className="hint">{state.success}</span> : null}
    </form>
  );
}
