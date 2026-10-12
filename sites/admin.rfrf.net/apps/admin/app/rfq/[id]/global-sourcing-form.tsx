'use client';

import { useActionState, useState } from 'react';
import type { GlobalDiscoveryProviderStatus } from '../../../lib/global-sourcing/provider-registry';
import {
  discoverGlobalCandidates,
  type GlobalSourcingActionState,
} from './global-sourcing-actions';

export function GlobalSourcingForm({
  rfqId,
  rfqItemId,
  defaultQuery,
  providers,
}: {
  rfqId: string;
  rfqItemId: string;
  defaultQuery: string;
  providers: GlobalDiscoveryProviderStatus[];
}) {
  const [state, action, pending] = useActionState<
    GlobalSourcingActionState,
    FormData
  >(discoverGlobalCandidates, {});
  const [providerKey, setProviderKey] = useState(
    () =>
      providers.find((provider) => provider.configured)?.key ??
      providers[0]?.key ??
      '',
  );
  const provider =
    providers.find((item) => item.key === providerKey) ?? providers[0] ?? null;

  return (
    <form action={action} className="qform">
      <input type="hidden" name="rfqId" value={rfqId} />
      <input type="hidden" name="rfqItemId" value={rfqItemId} />
      <input type="hidden" name="providerKey" value={provider?.key ?? ''} />
      <div className="qgrid">
        <label>
          {provider?.inputLabel ?? 'استعلام البحث'}
          <input
            name="query"
            defaultValue={defaultQuery}
            minLength={3}
            maxLength={provider?.maxQueryLength ?? 100}
            required
            dir="auto"
            autoComplete="off"
            placeholder={provider?.inputLabel ?? 'رقم OEM أو اسم القطعة'}
          />
        </label>
        <label>
          الموصل
          <select
            value={provider?.key ?? ''}
            onChange={(event) => setProviderKey(event.target.value)}
          >
            {providers.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label} —{' '}
                {item.configured ? 'الإعدادات مكتملة' : 'غير مفعّل'}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state.error ? (
        <p className="err" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="selected-note" role="status">
          ✓ {state.success}
        </p>
      ) : null}

      <button type="submit" disabled={pending || !provider?.configured}>
        {pending
          ? 'يبحث في المصدر العالمي…'
          : `استكشف نتائج ${provider?.label ?? 'المصدر'}`}
      </button>
      <p className="qhint">
        {provider?.inputHint ?? 'مصدر البحث غير محدد.'} هذا بحث إداري خام فقط؛
        لا ينشئ مورداً أو عرضاً أو طلب شراء، ولا يرسل رقم الهيكل. تُراجع النتائج
        والتوافق والتكلفة الواصلة قبل أي تحويل لاحق. اكتمال الإعدادات لا يثبت
        اتصالاً ناجحاً؛ نتيجة آخر تشغيل هي الدليل.
      </p>
      {!provider?.configured ? (
        <p className="err" role="status">
          فعّل هذا الموصل وأكمل إعداداته الخادمية؛ تظهر حالته في readiness.
        </p>
      ) : null}
    </form>
  );
}
