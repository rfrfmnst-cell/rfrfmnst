import { createHmac, timingSafeEqual } from 'node:crypto';
import { TapError, TapHostedClient, tapConfigFromEnv, verifyTapChargeWebhook } from './tap-hosted.ts';

export type AttemptState = 'INITIATING' | 'PENDING' | 'UNKNOWN' | 'CAPTURED' | 'FAILED' | 'CANCELLED';
export interface Attempt {
  attempt_id: string;
  order_id: string;
  order_code: string;
  amount_minor: number;
  currency: 'SAR';
  mode: 'sandbox' | 'live';
  merchant_id: string;
  state: AttemptState;
  charge_id: string | null;
  checkout_url: string | null;
  notified_at: string | null;
  last_error: string | null;
}
export interface AttemptStore {
  insert(attempt: Attempt): Promise<boolean>;
  find(attemptId: string): Promise<Attempt | null>;
  update(attemptId: string, states: AttemptState[], patch: Partial<Attempt>): Promise<void>;
}
type Env = Record<string, string | undefined>;
const result = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TapError('invalid_request');
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new TapError('invalid_request');
  return value.trim();
}
function equalSecret(a: string | null, b: string | undefined): boolean {
  if (!a || !b || a.length > 4096 || a.length !== b.length) return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function serviceKey(req: Request, env: Env): string | null {
  const supplied = req.headers.get('x-rafraf-service-key');
  return equalSecret(supplied, env.SUPABASE_SERVICE_ROLE_KEY) ? supplied : null;
}
async function readJson(req: Request, max = 16384): Promise<unknown> {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new TapError('json_required');
  const reader = req.body?.getReader();
  if (!reader) throw new TapError('invalid_request');
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new TapError('request_too_large'); }
      parts.push(value);
    }
    const body = new Uint8Array(size); let offset = 0;
    for (const part of parts) { body.set(part, offset); offset += part.byteLength; }
    return JSON.parse(new TextDecoder().decode(body));
  } catch (error) { if (error instanceof TapError) throw error; throw new TapError('invalid_json'); }
}
function siteOrigin(env: Env): string {
  const url = new URL(env.RAFRAF_SITE_ORIGIN || 'https://rfrf.net');
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash)
    throw new TapError('site_origin_invalid');
  return url.origin;
}
function money(minor: number): string { return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`; }
const OPEN: AttemptState[] = ['INITIATING', 'PENDING', 'UNKNOWN'];

/** Internal bridge only. Customers never supply the amount or a Supabase service key. */
export function createTapService(options: { env: Env; store: AttemptStore; send?: typeof fetch; now?: () => Date }) {
  const { env, store } = options, send = options.send || fetch, now = options.now || (() => new Date());
  async function notify(attempt: Attempt): Promise<boolean> {
    if (attempt.notified_at) return true;
    if (!env.SUPABASE_SERVICE_ROLE_KEY) return false;
    const timestamp = String(now().getTime());
    const body = JSON.stringify({ orderCode: attempt.attempt_id, externalRef: attempt.charge_id,
      outcome: attempt.state, amount: money(attempt.amount_minor), currency: 'SAR' });
    const signature = createHmac('sha256', env.SUPABASE_SERVICE_ROLE_KEY).update(`${timestamp}.${body}`).digest('hex');
    try {
      const response = await send(`${siteOrigin(env)}/api/payments/tap/webhook`, {
        method: 'POST', headers: { 'content-type': 'application/json',
          'x-rafraf-timestamp': timestamp, 'x-rafraf-signature': signature }, body,
        redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) return false;
      await store.update(attempt.attempt_id, [attempt.state], { notified_at: now().toISOString() });
      return true;
    } catch { return false; }
  }

  async function confirm(attempt: Attempt, chargeId: string): Promise<Attempt> {
    const config = tapConfigFromEnv(env);
    if (!config || config.mode !== attempt.mode || config.merchantId !== attempt.merchant_id) throw new TapError('configuration_mismatch', true);
    if (attempt.charge_id && attempt.charge_id !== chargeId) throw new TapError('charge_conflict', true);
    const charge = await new TapHostedClient(config, send).status({ id: chargeId,
      orderCode: attempt.attempt_id, amount: money(attempt.amount_minor), currency: attempt.currency });
    const patch = { state: charge.status, charge_id: chargeId, last_error: null };
    await store.update(attempt.attempt_id, OPEN, patch);
    // Re-read after compare-and-swap: delayed callbacks cannot regress a terminal payment.
    const current = await store.find(attempt.attempt_id);
    if (!current) throw new TapError('attempt_missing', true);
    // A newer terminal provider result that conflicts with our settled result
    // needs investigation, never silently acknowledge a refund or reversal.
    if (!OPEN.includes(current.state) && current.state !== charge.status)
      throw new TapError('terminal_state_conflict', true);
    return current;
  }

  return async function handle(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname.split('/').filter(Boolean).at(-1);
    if (req.method === 'GET' && path === 'health') {
      const mode = env.TAP_MODE?.trim();
      const key = env.TAP_SECRET_KEY?.trim();
      const merchant = env.TAP_MERCHANT_ID?.trim();
      return result({ ok: true, service: 'rafraf-tap', version: 1,
        configuration: {
          secretPresent: Boolean(key), merchantPresent: Boolean(merchant),
          modeValid: mode === 'sandbox' || mode === 'live',
          secretModeMatches: Boolean(key && (mode === 'sandbox' ? key.startsWith('sk_test_') : mode === 'live' && key.startsWith('sk_live_'))),
          merchantFormatValid: Boolean(merchant && /^[A-Za-z0-9_-]+$/.test(merchant)),
        },
      });
    }
    if (req.method !== 'POST') return result({ error: 'method_not_allowed' }, 405);
    if (path !== 'webhook' && !serviceKey(req, env)) return result({ error: 'unauthorized' }, 401);
    const config = tapConfigFromEnv(env);
    if (path === 'configuration') return result({ configured: Boolean(config),
      checkoutEnabled: Boolean(config && env.TAP_CHECKOUT_ENABLED === 'true' &&
        (config.mode === 'sandbox' || env.TAP_LIVE_ENABLED === 'true')),
      mode: config?.mode ?? null,
      missing: ['TAP_SECRET_KEY', 'TAP_MERCHANT_ID', 'TAP_MODE'].filter(key => !env[key]?.trim()),
    });
    if (!config) return result({ error: 'tap_not_configured' }, 503);
    try {
      if (path === 'checkout') {
        if (env.TAP_CHECKOUT_ENABLED !== 'true' || (config.mode === 'live' && env.TAP_LIVE_ENABLED !== 'true'))
          return result({ error: 'checkout_disabled' }, 503);
        const input = object(await readJson(req));
        const attemptId = string(input.attemptId, 100), orderId = string(input.orderId, 100), orderCode = string(input.orderCode, 100);
        if (!/^RF-[A-Z0-9-]{3,96}$/.test(attemptId) || !/^ORD-[A-Z0-9-]{3,96}$/.test(orderCode) ||
            typeof input.amountMinor !== 'number' || !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || input.currency !== 'SAR')
          throw new TapError('invalid_order');
        const origin = siteOrigin(env), payer = object(input.payer);
        const customer = { firstName: string(payer.firstName, 100), lastName: string(payer.lastName, 100),
          email: string(payer.email, 254), phone: string(payer.phone, 30) };
        const attempt: Attempt = { attempt_id: attemptId, order_id: orderId, order_code: orderCode,
          amount_minor: input.amountMinor, currency: 'SAR', mode: config.mode, merchant_id: config.merchantId,
          state: 'INITIATING', charge_id: null, checkout_url: null, notified_at: null, last_error: null };
        const inserted = await store.insert(attempt);
        if (!inserted) {
          const existing = await store.find(attemptId);
          if (!existing || existing.order_id !== orderId || existing.order_code !== orderCode ||
              existing.amount_minor !== attempt.amount_minor || existing.mode !== config.mode || existing.merchant_id !== config.merchantId)
            return result({ error: 'active_payment_conflict' }, 409);
          if (existing.state === 'PENDING' && existing.checkout_url && existing.charge_id)
            return result({ redirectUrl: existing.checkout_url, externalRef: existing.charge_id });
          return result({ error: 'payment_attempt_in_progress', state: existing.state }, 409);
        }
        try {
          const authorized = await new TapHostedClient(config, send).authorize({ orderCode: attemptId,
            money: { amount: money(attempt.amount_minor), currency: 'SAR' },
            description: `Rafraf order ${orderCode}`, payer: customer,
            returnUrl: `${origin}/track?code=${encodeURIComponent(orderCode)}&paymentReturn=1`,
            notificationUrl: `${env.SUPABASE_URL}/functions/v1/rafraf-tap/webhook`,
          });
          await store.update(attemptId, ['INITIATING', 'UNKNOWN'], {
            state: 'PENDING', charge_id: authorized.externalRef, checkout_url: authorized.redirectUrl });
          return result(authorized);
        } catch (error) {
          const uncertain = !(error instanceof TapError) || error.retryable;
          await store.update(attemptId, ['INITIATING'], { state: uncertain ? 'UNKNOWN' : 'FAILED',
            last_error: error instanceof TapError ? error.message : 'provider_result_unknown' });
          return result({ error: uncertain ? 'checkout_outcome_unknown' : 'checkout_rejected', retryable: uncertain }, uncertain ? 503 : 502);
        }
      }
      if (path === 'status') {
        const body = object(await readJson(req)), attempt = await store.find(string(body.attemptId, 100));
        if (!attempt) return result({ error: 'not_found' }, 404);
        const chargeId = attempt.charge_id || (typeof body.externalRef === 'string' ? body.externalRef : '');
        if (!chargeId) return result({ error: 'charge_reference_unknown' }, 409);
        const current = await confirm(attempt, chargeId);
        return result({ attemptId: current.attempt_id, orderId: current.order_id, amountMinor: current.amount_minor,
          currency: current.currency, mode: current.mode, externalRef: current.charge_id, outcome: current.state });
      }
      if (path === 'webhook') {
        const payload = await readJson(req, 65536);
        if (!verifyTapChargeWebhook(payload, req.headers.get('hashstring'), config)) return result({ error: 'invalid_signature' }, 401);
        const body = object(payload), reference = object(body.reference);
        const attempt = await store.find(string(reference.order, 100));
        if (!attempt) return result({ accepted: true });
        const current = await confirm(attempt, string(body.id, 100));
        if (['CAPTURED', 'FAILED', 'CANCELLED'].includes(current.state) && !await notify(current))
          return result({ error: 'site_notification_pending' }, 503);
        return result({ accepted: true });
      }
      return result({ error: 'not_found' }, 404);
    } catch (error) {
      if (error instanceof TapError) return result({ error: error.message, retryable: error.retryable }, error.retryable ? 503 : 400);
      // Never log request headers, customer details, provider payloads or keys.
      return result({ error: 'payment_service_unavailable', retryable: true }, 503);
    }
  };
}
