import { ShippingRateForm } from './shipping-rate-form';
import type { OtoFulfillmentStatus } from '../../../lib/shipping/oto';

export function ShippingRatePanel({
  status,
}: {
  status: OtoFulfillmentStatus;
}) {
  const configured = status.configured;
  return (
    <section className="card-block">
      <div className="block-head">
        <div>
          <h2>مقارنة أسعار الشحن</h2>
          <p className="hint">
            OTO يعيد خيارات سعر تقديرية للمدن والوزن المدخلين فقط. لا ينشئ هذا
            المسار شحنة أو بوليصة.
          </p>
        </div>
        <div>
          <span
            className={`status ${configured ? 's-QUOTES_READY' : 's-DRAFT'}`}
          >
            {configured ? 'OTO جاهز للمقارنة' : 'OTO غير مفعّل'}
          </span>
          <p className="hint">RATES فقط · إنشاء الشحنة مقفل</p>
        </div>
      </div>
      {configured ? (
        <ShippingRateForm />
      ) : (
        <p className="hint">
          فعّل OTO server-side أولاً. يبقى إنشاء الشحنات مغلقاً حتى بعد التفعيل.
        </p>
      )}
    </section>
  );
}
