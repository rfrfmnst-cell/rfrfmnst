'use client';

import { useActionState } from 'react';
import { submitSupplier, type SupplierFormState } from './actions';

const initial: SupplierFormState = {};

export function SupplierForm() {
  const [state, action, pending] = useActionState(submitSupplier, initial);

  if (state.ok) {
    return (
      <div className="card success" role="status">
        <h3>تم استلام تسجيلك ✓</h3>
        <p>سيتواصل معك فريق رفرف لإكمال التحقق وتفعيل حسابك كمورد.</p>
      </div>
    );
  }

  return (
    <form action={action} className="card form" id="suppliers">
      <h3>سجّل كمورد</h3>
      <p className="muted">
        انضم مبكراً: طلبات جاهزة، تحويل مستحقات منضبط، ولوحة مورد تُبنى الآن.
      </p>

      <div className="grid2">
        <label>
          اسم النشاط / المؤسسة
          <input
            name="businessName"
            required
            maxLength={80}
            placeholder="مؤسسة النخبة لقطع الغيار"
            defaultValue={state.values?.businessName}
          />
        </label>
        <label>
          المدينة
          <input
            name="city"
            maxLength={40}
            placeholder="الرياض"
            defaultValue={state.values?.city}
          />
        </label>
      </div>

      <div className="grid2">
        <label>
          اسم المسؤول
          <input
            name="contactName"
            maxLength={80}
            placeholder="اختياري"
            defaultValue={state.values?.contactName}
          />
        </label>
        <label>
          الجوال
          <input
            name="phone"
            required
            inputMode="tel"
            dir="ltr"
            placeholder="05xxxxxxxx"
            pattern="^(\+9665|05|9665)[0-9]{8}$"
            defaultValue={state.values?.phone}
          />
        </label>
      </div>

      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending}>
        {pending ? 'جارٍ التسجيل…' : 'سجّل اهتمامك'}
      </button>
    </form>
  );
}
