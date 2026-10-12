'use server';

import { confirmCustomerReceipt } from '@rafraf/orders';
import { revalidatePath } from 'next/cache';
import { getSessionCustomerId } from '../../lib/session';

/**
 * تأكيد العميل استلام طلبه، وهو ما يختصر انتظار نافذة الشكوى.
 *
 * الهوية من الجلسة الموقّعة وحدها، ولا تُقرأ من النموذج: معرّف عميل قادم من
 * المتصفّح كان سيسمح بتأكيد استلام طلب شخص آخر. الملكية تُعاد فحصها داخل مسار
 * الكتابة أيضاً، فالتقييد هنا ليس الطبقة الوحيدة.
 */
export async function confirmOrderReceipt(fd: FormData): Promise<void> {
  const customerId = await getSessionCustomerId();
  const orderId = String(fd.get('orderId') ?? '').trim().slice(0, 40);
  if (!customerId || !orderId) return;

  try {
    await confirmCustomerReceipt({ orderId, customerId });
  } catch (error) {
    console.error(
      'confirmOrderReceipt failed:',
      error instanceof Error ? error.name : 'UNKNOWN',
    );
    return;
  }

  revalidatePath('/account');
  revalidatePath('/track');
}
