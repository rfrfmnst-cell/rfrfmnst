'use server';

import {
  approveQuoteAsCustomerUseCase,
  type CustomerApproveState,
} from './customer-actions/quote-approval';
import {
  getQuotesComparisonUseCase,
  type CustomerQuoteCard,
  type QuotesComparison,
} from './customer-actions/quote-comparison';
import {
  submitRfqUseCase,
  type RfqFormState,
} from './customer-actions/rfq-intake';
import {
  submitSupplierUseCase,
  type SupplierFormState,
} from './customer-actions/supplier-registration';
import {
  trackRequestUseCase,
  type TrackPaymentAction,
  type TrackState,
  type TrackTimelineEntry,
} from './customer-actions/tracking';
import { cancelAwaitingPaymentOrder } from '../lib/customer-order';
import { getSessionCustomerId } from '../lib/session';
import { revalidatePath } from 'next/cache';

export type {
  CustomerApproveState,
  CustomerQuoteCard,
  QuotesComparison,
  RfqFormState,
  SupplierFormState,
  TrackPaymentAction,
  TrackState,
  TrackTimelineEntry,
};

export async function submitRfq(
  previousState: RfqFormState,
  formData: FormData,
): Promise<RfqFormState> {
  return submitRfqUseCase(previousState, formData);
}

export async function getQuotesComparison(
  code: string,
): Promise<QuotesComparison> {
  return getQuotesComparisonUseCase(code);
}

export async function submitSupplier(
  previousState: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  return submitSupplierUseCase(previousState, formData);
}

export async function trackRequest(
  previousState: TrackState,
  formData: FormData,
): Promise<TrackState> {
  return trackRequestUseCase(previousState, formData);
}

export async function approveQuoteAsCustomer(
  previousState: CustomerApproveState,
  formData: FormData,
): Promise<CustomerApproveState> {
  return approveQuoteAsCustomerUseCase(previousState, formData);
}

export async function cancelCustomerAwaitingPaymentOrder(
  formData: FormData,
): Promise<void> {
  const customerId = await getSessionCustomerId();
  const orderId = String(formData.get('orderId') ?? '')
    .trim()
    .slice(0, 40);
  if (!customerId || !orderId) return;

  try {
    await cancelAwaitingPaymentOrder({ customerId, orderId });
  } catch (error) {
    console.error(
      'cancelCustomerAwaitingPaymentOrder failed:',
      error instanceof Error ? error.name : 'UNKNOWN',
    );
    return;
  }
  revalidatePath('/account');
  revalidatePath('/track');
}
