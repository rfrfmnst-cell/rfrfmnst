'use client';

import type { SourcingMarket } from '@rafraf/shared/product-os/sourcing-market';
import { useActionState, useState } from 'react';
import { addQuote } from '../../quote-write-actions';

interface State {
  error?: string;
}

export function QuoteForm({
  rfqId,
  rfqItemId,
}: {
  rfqId: string;
  rfqItemId: string;
}) {
  const [state, action, pending] = useActionState(
    async (_prev: State, fd: FormData) => addQuote(fd),
    {} as State,
  );
  const [market, setMarket] = useState<SourcingMarket>('SAUDI');

  return (
    <form action={action} className="qform">
      <input type="hidden" name="rfqId" value={rfqId} />
      <input type="hidden" name="rfqItemId" value={rfqItemId} />

      <div className="qgrid">
        <label>
          المورد
          <input
            name="supplierName"
            required
            placeholder="مؤسسة النخبة — الرياض"
          />
        </label>
        <label>
          السوق
          <select
            name="market"
            value={market}
            onChange={(event) =>
              setMarket(event.target.value as SourcingMarket)
            }
          >
            <option value="SAUDI">سعودي</option>
            <option value="GCC">خليجي</option>
            <option value="GLOBAL">عالمي</option>
          </select>
        </label>
        {market !== 'SAUDI' ? (
          <>
            <label>
              اسم المصدر الخارجي
              <input
                name="sourceName"
                required
                minLength={2}
                maxLength={120}
                placeholder="اسم المزود أو السوق الموثق"
              />
            </label>
            <label>
              رمز بلد المصدر
              <input
                name="sourceCountry"
                required
                dir="ltr"
                maxLength={2}
                pattern="[A-Za-z]{2}"
                autoCapitalize="characters"
                placeholder={market === 'GCC' ? 'AE' : 'DE'}
                title="رمز البلد من حرفين، مثل AE أو DE"
              />
            </label>
          </>
        ) : null}
        <label>
          سعر المورد (ر.س)
          <input
            name="supplierPrice"
            required
            inputMode="decimal"
            dir="ltr"
            placeholder="210"
          />
        </label>
        <label>
          الشحن المحلي
          <input
            name="localShipping"
            inputMode="decimal"
            dir="ltr"
            placeholder="0"
          />
        </label>
        <label>
          الشحن الدولي
          <input
            name="intlShipping"
            inputMode="decimal"
            dir="ltr"
            placeholder="0"
          />
        </label>
        <label>
          جمارك تقديرية
          <input
            name="customsEstimate"
            inputMode="decimal"
            dir="ltr"
            placeholder="0"
          />
        </label>
        <label>
          فحص
          <input
            name="inspectionFee"
            inputMode="decimal"
            dir="ltr"
            placeholder="0"
          />
        </label>
        <label>
          رسوم دفع
          <input
            name="paymentFee"
            inputMode="decimal"
            dir="ltr"
            placeholder="0"
          />
        </label>
        <label>
          تغليف
          <input
            name="packagingFee"
            inputMode="decimal"
            dir="ltr"
            placeholder="0"
          />
        </label>
        <label>
          احتياطي مخاطر
          <input
            name="riskBuffer"
            inputMode="decimal"
            dir="ltr"
            placeholder="0"
          />
        </label>
        <label>
          هامش رفرف
          <input
            name="platformMargin"
            inputMode="decimal"
            dir="ltr"
            placeholder="30"
          />
        </label>
        <label>
          مدة الوصول (أيام)
          <input
            name="deliveryDays"
            inputMode="numeric"
            dir="ltr"
            placeholder="2"
          />
        </label>
        <label>
          الضمان (شهور)
          <input
            name="warrantyMonths"
            inputMode="numeric"
            dir="ltr"
            placeholder="12"
          />
        </label>
        <label>
          ثقة التوافق (0–1)
          <input
            name="fitmentConfidence"
            inputMode="decimal"
            dir="ltr"
            placeholder="0.95"
          />
        </label>
        <label>
          المخاطر
          <select name="riskLevel" defaultValue="" required>
            <option value="" disabled>
              اختر نتيجة المراجعة
            </option>
            <option value="LOW">منخفضة</option>
            <option value="MEDIUM">متوسطة</option>
            <option value="HIGH">عالية</option>
            <option value="BLOCKED">محظورة</option>
          </select>
        </label>
      </div>

      {state.error ? <p className="err">{state.error}</p> : null}

      <button type="submit" disabled={pending}>
        {pending ? 'يحسب السعر الواصل…' : 'أضف العرض واحسب القرار'}
      </button>
      <p className="qhint">
        الحفظ يمرّ بمحرك Landed Cost ثم يعيد ترتيب كل العروض بمعادلة القرار (سقف
        0.88) ويحدّث حالة الطلب إلى «عروض جاهزة».
      </p>
    </form>
  );
}
