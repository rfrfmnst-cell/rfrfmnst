import { type SupplierStatus } from '@rafraf/db';

/** رسالة fail-closed للحالات التي لا يجوز لها استقبال RFQ جديد. */
export function supplierSourcingAccessNotice(status: SupplierStatus): string {
  if (status === 'LIMITED') {
    return 'الحساب مقيّد للقراءة فقط ولا يستقبل طلبات تسعير جديدة حتى تُرفع القيود أو تضيف المنصة نطاقاً تشغيلياً واضحاً لها.';
  }
  if (status === 'SUSPENDED') {
    return 'الحساب موقوف مؤقتاً. تواصل مع فريق رفرف لاستكمال المراجعة.';
  }
  if (status === 'REJECTED') {
    return 'تعذّر اعتماد طلب المنشأة. تواصل مع فريق رفرف لمعرفة الخطوة التالية.';
  }
  return 'تم استلام تسجيل المنشأة وهو الآن قيد مراجعة فريق رفرف. ستظهر طلبات التسعير بعد اعتماد الحساب.';
}
