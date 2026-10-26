import { timingSafeEqual } from 'node:crypto';
import { createOtoFulfillment, type OtoRateRequest } from '../../../sites/admin.rfrf.net/apps/admin/lib/shipping/oto.ts';
import { otoFulfillmentConfigFromEnv, opaqueToken } from '../../../sites/admin.rfrf.net/apps/admin/lib/shipping/oto-config.ts';
import { buildOtoOrderDraft, type OtoCreateOrderRequest } from '../../../sites/admin.rfrf.net/apps/admin/lib/shipping/oto-operational.ts';
import { parseBoundedJson, toRecord } from '../../../sites/admin.rfrf.net/apps/admin/lib/shipping/oto-response.ts';

type Env = Record<string, string | undefined>;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
function authorized(req: Request, env: Env): boolean {
  const supplied = req.headers.get('x-rafraf-service-key'), expected = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supplied || !expected || supplied.length > 4096) return false;
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function body(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get('content-type')?.startsWith('application/json')) throw Error('invalid_json');
  const reader = req.body?.getReader(); if (!reader) throw Error('invalid_json');
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 32768) { await reader.cancel(); throw Error('request_too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('invalid_json');
  return parsed as Record<string, unknown>;
}

/** Quotes, read-only connection verification and local draft preview only. */
export function createOtoService(env: Env, send: typeof fetch = fetch) {
  return async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname.split('/').filter(Boolean).at(-1);
    const config = otoFulfillmentConfigFromEnv(env);
    if (req.method === 'GET' && path === 'health') return json({ ok: true, service: 'rafraf-oto',
      configuration: { tokenPresent: Boolean(env.OTO_REFRESH_TOKEN?.trim()), enabled: env.OTO_ENABLED === 'true',
        automaticShipmentDisabled: env.OTO_AUTO_CREATE_SHIPMENT === 'false' && env.SHIPMENT_AUTO_CREATE === 'false',
        configured: Boolean(config) }, createsShipments: false });
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!authorized(req, env)) return json({ error: 'unauthorized' }, 401);
    if (!config) return json({ error: 'oto_not_configured' }, 503);
    try {
      if (path === 'connection') {
        const auth = await send('https://api.tryoto.com/rest/v2/refreshToken', {
          method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ refresh_token: config.refreshToken }), redirect: 'error',
          signal: AbortSignal.timeout(10000), cache: 'no-store',
        });
        if (!auth.ok) return json({ error: 'oto_authentication_failed' }, 502);
        const data = toRecord(await parseBoundedJson(auth, () => Error('OTO_RESPONSE_INVALID')));
        const token = opaqueToken(data?.access_token ?? data?.accessToken ?? data?.token);
        if (!token) return json({ error: 'oto_authentication_failed' }, 502);
        const health = await send('https://api.tryoto.com/rest/v2/healthCheck', {
          method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${token}` },
          redirect: 'error', signal: AbortSignal.timeout(10000), cache: 'no-store',
        });
        await health.body?.cancel();
        return health.ok ? json({ connected: true, createsShipments: false }) : json({ error: 'oto_health_check_failed' }, 502);
      }
      if (path === 'rates') {
        const input = await body(req);
        const rates = await createOtoFulfillment(config, { fetchImpl: send }).getRates(input as unknown as OtoRateRequest);
        return json({ rates, createsShipments: false });
      }
      if (path === 'draft') {
        // Preview never calls createOrder or createShipment. The existing
        // administration flow remains responsible for paid-order eligibility.
        const input = await body(req);
        if (!Array.isArray(input.items) || !input.customer || typeof input.customer !== 'object')
          return json({ error: 'invalid_draft' }, 400);
        const draft = buildOtoOrderDraft(input as unknown as OtoCreateOrderRequest);
        return json({ draft, submitted: false, createsShipments: false });
      }
      return json({ error: 'not_found' }, 404);
    } catch (error) {
      const retryable = Boolean(error && typeof error === 'object' && 'retryable' in error && error.retryable);
      const code = error instanceof Error && /^(OTO_[A-Z_]+|invalid_json|request_too_large)$/.test(error.message)
        ? error.message : 'oto_service_unavailable';
      return json({ error: code, retryable }, retryable ? 503 : code === 'oto_service_unavailable' ? 502 : 400);
    }
  };
}
