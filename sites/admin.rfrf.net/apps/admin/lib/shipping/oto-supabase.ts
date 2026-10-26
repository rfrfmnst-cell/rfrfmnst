import { OtoFulfillmentError, type OtoFulfillmentAdapter } from './oto.ts';

/** Server-only transport for the existing admin rate-comparison workflow. */
export function createSupabaseOtoFulfillment(
  env: Record<string, string | undefined>,
  send: typeof fetch = fetch,
): OtoFulfillmentAdapter | null {
  const project = env.SUPABASE_URL?.replace(/\/$/, ''),
    key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (project !== 'https://gfxnwfjjpxmzvnylushd.supabase.co' || !key)
    return null;
  return {
    key: 'OTO',
    capabilities: ['RATES'],
    async getRates(request) {
      let response: Response;
      try {
        response = await send(`${project}/functions/v1/rafraf-oto/rates`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-rafraf-service-key': key,
          },
          body: JSON.stringify(request),
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(30000),
        });
      } catch {
        throw new OtoFulfillmentError('OTO_UNAVAILABLE', true);
      }
      if (!response.ok)
        throw new OtoFulfillmentError(
          response.status === 400 ? 'OTO_REQUEST_INVALID' : 'OTO_UNAVAILABLE',
          response.status >= 500,
        );
      let result;
      try {
        result = await response.json();
      } catch {
        throw new OtoFulfillmentError('OTO_RESPONSE_INVALID', true);
      }
      if (
        !Array.isArray(result.rates) ||
        result.rates.length > 100 ||
        result.createsShipments !== false
      )
        throw new OtoFulfillmentError('OTO_RESPONSE_INVALID', true);
      return result.rates;
    },
  };
}
