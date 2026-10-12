'use client';

import { useActionState } from 'react';
import {
  compareShippingRates,
  type ShippingRateActionState,
} from './shipping-rate-actions';

const GCC_COUNTRIES = [
  ['SA', 'السعودية'],
  ['AE', 'الإمارات'],
  ['BH', 'البحرين'],
  ['KW', 'الكويت'],
  ['OM', 'عُمان'],
  ['QA', 'قطر'],
] as const;

export function ShippingRateForm() {
  const [state, action, pending] = useActionState<
    ShippingRateActionState,
    FormData
  >(compareShippingRates, {});

  return (
    <form action={action} className="qform">
      <div className="qgrid">
        <label>
          مدينة الاستلام
          <input
            name="originCity"
            minLength={2}
            maxLength={100}
            required
            autoComplete="off"
            placeholder="مثال: Riyadh"
          />
        </label>
        <label>
          بلد الاستلام
          <select name="originCountry" defaultValue="SA">
            {GCC_COUNTRIES.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          مدينة التسليم
          <input
            name="destinationCity"
            minLength={2}
            maxLength={100}
            required
            autoComplete="off"
            placeholder="مثال: Jeddah"
          />
        </label>
        <label>
          بلد التسليم
          <select name="destinationCountry" defaultValue="SA">
            {GCC_COUNTRIES.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          الوزن التقريبي (كجم)
          <input
            name="weightKg"
            type="number"
            min="0.01"
            max="99999"
            step="0.01"
            required
            inputMode="decimal"
            placeholder="1.5"
          />
        </label>
      </div>

      {state.error ? <p className="err">{state.error}</p> : null}
      {state.success ? (
        <p className="selected-note" role="status">
          ✓ {state.success}
        </p>
      ) : null}

      <button type="submit" disabled={pending}>
        {pending ? 'يجلب خيارات الناقلين…' : 'قارن أسعار الشحن'}
      </button>
      <p className="qhint">
        يُرسل هذا النموذج المدن والوزن فقط لطلب سعر تقديري. لا يقرأ عنوان العميل
        أو هاتفه، ولا ينشئ Order أو Shipment أو Label.
      </p>

      {state.rates?.length ? (
        <div className="table-wrap" style={{ marginTop: '1rem' }}>
          <table>
            <thead>
              <tr>
                <th>الناقل</th>
                <th>الخدمة / ETA</th>
                <th>السعر التقديري</th>
                <th>الإرجاع / الوزن</th>
              </tr>
            </thead>
            <tbody>
              {state.rates.map((rate) => (
                <tr key={rate.deliveryOptionId}>
                  <td>{rate.deliveryOptionName ?? rate.deliveryCompanyName}</td>
                  <td>
                    {rate.serviceType ?? '—'}
                    <div className="hint">
                      {rate.averageDeliveryTime ?? 'المدة غير معلنة'}
                    </div>
                    <div className="hint">
                      نمط التسليم: {rate.pickupDropoff ?? 'غير محدد'}
                    </div>
                  </td>
                  <td className="mono">
                    {rate.price.toFixed(2)} {rate.currency}
                  </td>
                  <td>
                    {rate.returnFee === null
                      ? '—'
                      : `${rate.returnFee.toFixed(2)} ${rate.currency}`}
                    <div className="hint">
                      وزن مجاني: {rate.maxFreeWeightKg ?? '—'} كجم
                    </div>
                    <div className="hint">
                      الحد الأقصى للطلب:{' '}
                      {rate.maxOrderValue === null
                        ? '—'
                        : `${rate.maxOrderValue.toFixed(2)} ${rate.currency}`}
                    </div>
                    <div className="hint">
                      حد الدفع عند الاستلام:{' '}
                      {rate.maxCodValue === null
                        ? '—'
                        : `${rate.maxCodValue.toFixed(2)} ${rate.currency}`}
                    </div>
                    <div className="hint">
                      رسوم الدفع عند الاستلام:{' '}
                      {rate.codCharge === null
                        ? '—'
                        : `${rate.codCharge.toFixed(2)} ${rate.currency}`}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </form>
  );
}
