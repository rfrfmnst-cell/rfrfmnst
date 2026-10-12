import { verifyTurnstileToken } from '@rafraf/shared/security/turnstile';
import { reserveCustomerTurnstileSiteverify } from './turnstile-quota';

export async function verifyCustomerHumanProof(
  token: unknown,
  expectedAction: string,
  requestIpSubject: string | null,
): Promise<'verified' | 'rate_limited' | 'unavailable'> {
  const proof = await verifyTurnstileToken({
    token,
    expectedAction,
    reserveSiteverify: () =>
      reserveCustomerTurnstileSiteverify(requestIpSubject),
  });
  if (proof.ok) return 'verified';
  return proof.reason === 'rate_limited' ? 'rate_limited' : 'unavailable';
}
