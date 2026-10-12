export function ManualPaymentForm() {
  return (
    <section className="send-form" aria-labelledby="manual-payment-status">
      <strong id="manual-payment-status">الدفع اليدوي غير متاح</strong>
      <button type="button" disabled>
        تسجيل تحويل بنكي — موقوف
      </button>
      <span className="hint">
        المرجع النصي ليس إثبات تسوية. التحويل البنكي وCOD مغلقان حتى يوجد إثبات
        موثق ومسار رد قابل للمطابقة.
      </span>
    </section>
  );
}
