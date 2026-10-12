import { ADMIN_DASHBOARD_URL } from '../../lib/admin-public-url';
import { approveCustomerQuote } from '../../lib/customer-quote-approval';
import { notifyOps } from '../../lib/notify';
import { getSessionCustomerId } from '../../lib/session';

/* ─── اعتماد العميل الذاتي (الزر البرتقالي — WORKFLOW_UI البند الحرج 1) ───
 * الجلسة الموقعة هي مصدر هوية العميل. خدمة الاعتماد المشتركة تعيد فحص الملكية
 * والسياسة والمخاطر داخل معاملة مقفلة على RFQ. */

export interface CustomerApproveState {
  ok?: boolean;
  orderCode?: string;
  error?: string;
}

export async function approveQuoteAsCustomerUseCase(
  _prev: CustomerApproveState,
  fd: FormData,
): Promise<CustomerApproveState> {
  try {
    const customerId = await getSessionCustomerId();
    if (!customerId) return { error: 'سجّل الدخول لتأكيد اعتماد العرض.' };

    const code = String(fd.get('code') ?? '')
      .trim()
      .toUpperCase();
    const quoteId = String(fd.get('quoteId') ?? '');
    if (!/^RFQ-\d{4}-\d{5}$/.test(code) || !quoteId)
      return { error: 'طلب غير صالح.' };

    const result = await approveCustomerQuote({
      customerId,
      quoteId,
      rfqCode: code,
      source: 'comparison',
    });
    if (result.created) {
      await notifyOps(
        `💰 عميل اعتمد عرضاً بنفسه!\n${result.rfqCode} → ${result.orderCode}\nالمبلغ: ${result.totalAmount} ${result.currency}${ADMIN_DASHBOARD_URL ? `\nسجّل الدفع من اللوحة: ${ADMIN_DASHBOARD_URL}` : ''}`,
      );
    }

    return { ok: true, orderCode: result.orderCode };
  } catch (e) {
    console.error('approveQuoteAsCustomer failed:', e);
    return {
      error: 'ما لقينا عرضاً متاحاً للاعتماد. حدّث الصفحة وجرّب ثانية.',
    };
  }
}
