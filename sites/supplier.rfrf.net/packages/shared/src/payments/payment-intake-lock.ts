export function orderPaymentIntakeLockKey(orderId: string): string {
  if (!orderId.trim()) throw new Error('order id is required');
  return `order-payment-intake:${orderId}`;
}
