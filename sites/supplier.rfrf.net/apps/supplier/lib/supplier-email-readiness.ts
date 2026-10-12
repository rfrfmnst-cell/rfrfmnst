import { supplierEmailConfigured } from './supplier-email-auth.ts';

/** Read-only provider authentication and sender-domain check; sends no email. */
export async function supplierEmailReadiness(
  env: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch,
): Promise<{ ready: boolean; reason: string | null }> {
  if (!supplierEmailConfigured(env))
    return { ready: false, reason: 'email_configuration_missing' };
  const domain = env.SUPPLIER_EMAIL_FROM!.trim().toLowerCase().split('@')[1];
  try {
    const response = await request('https://api.resend.com/domains?limit=100', {
      method: 'GET',
      redirect: 'error',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY!.trim()}` },
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok)
      return { ready: false, reason: 'email_provider_authentication_failed' };
    if (!response.body)
      return { ready: false, reason: 'email_provider_response_invalid' };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 262_144) {
          await reader.cancel();
          return { ready: false, reason: 'email_provider_response_invalid' };
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const text = Buffer.concat(chunks).toString('utf8');
    const body = JSON.parse(text) as { data?: unknown };
    if (!Array.isArray(body.data))
      return { ready: false, reason: 'email_provider_response_invalid' };
    const verified = body.data.some((value: unknown) => {
      if (!value || typeof value !== 'object') return false;
      const entry = value as Record<string, unknown>;
      return (
        typeof entry.name === 'string' &&
        entry.name.toLowerCase() === domain &&
        entry.status === 'verified'
      );
    });
    return verified
      ? { ready: true, reason: null }
      : { ready: false, reason: 'email_sender_domain_unverified' };
  } catch {
    return { ready: false, reason: 'email_provider_unreachable' };
  }
}
