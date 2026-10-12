export const CUSTOMER_SITE_ORIGIN = 'https://rfrf.net';
export const CUSTOMER_SITE_TITLE = 'رفرف — منصة توريد ذكية لقطع غيار السيارات';
export const CUSTOMER_SITE_DESCRIPTION =
  'اطلب قطعة الغيار، قارن العروض محلياً ودولياً بالسعر النهائي الواصل، واتّبع طلبك حتى التسليم.';

// Authentication, conversations and order tracking are customer journeys.
export const PUBLIC_INDEXABLE_PATHS = ['/', '/privacy'] as const;
export const PRIVATE_CRAWLER_PATHS = [
  '/account',
  '/api/',
  '/chat',
  '/login',
  '/track',
];
