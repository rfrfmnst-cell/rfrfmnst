import type { Metadata } from 'next';
import { ProductionChat } from './production-chat';
import { turnstileSiteKey } from '@rafraf/shared/security/turnstile';

export const metadata: Metadata = {
  title: 'مساعد رفرف الذكي — اطلب قطعتك بالدردشة',
};

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const params = await searchParams;
  if (process.env.NODE_ENV !== 'production' && params.preview === '1') {
    const { PreviewChat } = await import('./preview-chat');
    return <PreviewChat turnstileSiteKey={turnstileSiteKey() ?? ''} />;
  }
  return <ProductionChat turnstileSiteKey={turnstileSiteKey() ?? ''} />;
}
