export function SupplierRiskFields({
  approval = false,
}: {
  approval?: boolean;
}) {
  return (
    <label>
      <span>تقييم المخاطر بعد مراجعة المورد</span>
      <select name="riskLevel" required defaultValue="">
        <option value="" disabled>
          اختر نتيجة المراجعة
        </option>
        <option value="LOW">منخفض</option>
        <option value="MEDIUM">متوسط</option>
        {!approval ? (
          <option value="HIGH">مرتفع — إيقاف التعامل المالي</option>
        ) : null}
        {!approval ? (
          <option value="BLOCKED">محظور — إيقاف التعامل المالي</option>
        ) : null}
      </select>
      <small>
        قرار بشري مسجل؛ لا يُستنتج من الذكاء الاصطناعي أو اكتمال التسجيل وحده.
      </small>
    </label>
  );
}
