'use server';

import { openCustomerDispute } from '@rafraf/orders';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getSessionCustomerId } from '../../lib/session';

export async function openCustomerOrderDispute(fd: FormData): Promise<void> {
  const customerId = await getSessionCustomerId();
  const orderId = String(fd.get('orderId') ?? '')
    .trim()
    .slice(0, 40);
  if (!customerId || !orderId) redirect('/login');

  let outcome: Awaited<ReturnType<typeof openCustomerDispute>>['outcome'];
  try {
    const result = await openCustomerDispute({
      orderId,
      customerId,
      reasonCode: fd.get('reasonCode'),
      description: fd.get('description'),
    });
    outcome = result.outcome;
  } catch (error) {
    console.error(
      'openCustomerOrderDispute failed:',
      error instanceof Error ? error.name : 'UNKNOWN',
    );
    redirect('/account?dispute=failed#orders-title');
  }

  revalidatePath('/account');
  revalidatePath('/track');
  redirect(
    `/account?dispute=${
      outcome === 'OPENED' || outcome === 'REPLAYED' ? 'opened' : 'invalid'
    }#orders-title`,
  );
}
