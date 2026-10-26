import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createTapService } from '../functions/_shared/tap-service.ts';

const env = { SUPABASE_SERVICE_ROLE_KEY: 'service-unit-fixture', SUPABASE_URL: 'https://fixture.supabase.co',
  TAP_SECRET_KEY: 'sk_test_unit_fixture', TAP_MERCHANT_ID: 'merchant_fixture', TAP_MODE: 'sandbox',
  TAP_CHECKOUT_ENABLED: 'true', RAFRAF_SITE_ORIGIN: 'https://rfrf.example' };
const input = { attemptId: 'RF-ATTEMPT-001', orderId: 'order-1', orderCode: 'ORD-ORDER-001', amountMinor: 12345,
  currency: 'SAR', payer: { firstName: 'Test', lastName: 'Customer', email: 'test@example.test', phone: '0501234567' } };
function memoryStore() {
  const rows = new Map();
  return { rows,
    async insert(row) {
      if (rows.has(row.attempt_id) || [...rows.values()].some(r => r.order_id === row.order_id && r.mode === row.mode &&
        ['INITIATING', 'PENDING', 'UNKNOWN', 'CAPTURED'].includes(r.state))) return false;
      rows.set(row.attempt_id, structuredClone(row)); return true;
    },
    async find(id) { return structuredClone(rows.get(id) ?? null); },
    async update(id, states, patch) { const row = rows.get(id); if (row && states.includes(row.state)) rows.set(id, { ...row, ...patch }); },
  };
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
function charge(status = 'INITIATED', patch = {}) {
  return { object: 'charge', id: 'chg_unit', live_mode: false, merchant: { id: env.TAP_MERCHANT_ID },
    amount: 123.45, currency: 'SAR', status, reference: { order: input.attemptId, payment: 'payment', gateway: 'gateway' },
    transaction: { created: '1792973653000', url: 'https://checkout.tap.company/session/unit' }, ...patch };
}
function signature(payload) {
  return createHmac('sha256', env.TAP_SECRET_KEY).update(`x_id${payload.id}x_amount${Number(payload.amount).toFixed(2)}` +
    `x_currency${payload.currency}x_gateway_reference${payload.reference.gateway ?? ''}x_payment_reference${payload.reference.payment}` +
    `x_status${payload.status}x_created${payload.transaction.created}`).digest('hex');
}
function request(path, body, authorized = true, extra = {}) {
  return new Request(`https://fixture.supabase.co/functions/v1/rafraf-tap/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json',
      ...(authorized ? { 'x-rafraf-service-key': env.SUPABASE_SERVICE_ROLE_KEY } : {}), ...extra }, body: JSON.stringify(body),
  });
}
function fixture(send, overrides = {}) {
  const store = memoryStore();
  const handler = createTapService({ env: { ...env, ...overrides }, store, send });
  return { store, handler };
}

test('public health reveals no credentials and checkout rejects anonymous or user-level access', async () => {
  const { handler, store } = fixture(async () => { throw Error('must not call Tap'); });
  const health = await handler(new Request('https://fixture.supabase.co/functions/v1/rafraf-tap/health'));
  assert.deepEqual(await health.json(), { ok: true, service: 'rafraf-tap', version: 1,
    configuration: { secretPresent: true, merchantPresent: true, modeValid: true, secretModeMatches: true, merchantFormatValid: true } });
  for (const req of [request('checkout', input, false), request('checkout', input, false, { authorization: 'Bearer user-jwt' }),
    request('checkout', input, false, { 'x-rafraf-service-key': 'wrong-key' })])
    assert.equal((await handler(req)).status, 401);
  assert.equal(store.rows.size, 0);
});

test('missing secrets and disabled or unapproved live checkout fail closed', async () => {
  for (const overrides of [{ TAP_SECRET_KEY: '' }, { TAP_CHECKOUT_ENABLED: 'false' },
    { TAP_MODE: 'live', TAP_SECRET_KEY: 'sk_live_unit_fixture' }]) {
    const { handler, store } = fixture(async () => { throw Error('must not call'); }, overrides);
    assert.equal((await handler(request('checkout', input))).status, 503);
    assert.equal(store.rows.size, 0);
  }
});

test('checkout persists an attempt and retry reuses the hosted session without creating another charge', async () => {
  let calls = 0;
  const { handler, store } = fixture(async (url, init) => {
    calls++; assert.equal(url, 'https://api.tap.company/v2/charges/');
    const payload = JSON.parse(init.body);
    assert.equal(payload.reference.idempotent, input.attemptId);
    assert.equal(payload.post.url, `${env.SUPABASE_URL}/functions/v1/rafraf-tap/webhook`);
    assert.equal(new URL(payload.redirect.url).origin, env.RAFRAF_SITE_ORIGIN);
    return json(charge());
  });
  for (let i = 0; i < 2; i++) {
    const r = await handler(request('checkout', input)); assert.equal(r.status, 200);
    assert.equal((await r.json()).externalRef, 'chg_unit');
  }
  assert.equal(calls, 1);
  assert.equal(store.rows.get(input.attemptId).state, 'PENDING');
  assert.equal('payer' in store.rows.get(input.attemptId), false);
});

test('concurrent checkout attempts for one order create only one provider charge', async () => {
  let calls = 0;
  const { handler, store } = fixture(async () => { calls++; return json(charge()); });
  const replies = await Promise.all([handler(request('checkout', input)),
    handler(request('checkout', { ...input, attemptId: 'RF-ATTEMPT-002' }))]);
  assert.deepEqual(replies.map(r => r.status).sort(), [200, 409]);
  assert.equal(calls, 1); assert.equal(store.rows.size, 1);
});

test('a timeout keeps the attempt unknown and blocks retries that could charge twice', async () => {
  let calls = 0;
  const { handler, store } = fixture(async () => { calls++; throw Error('network timeout'); });
  assert.equal((await handler(request('checkout', input))).status, 503);
  assert.equal(store.rows.get(input.attemptId).state, 'UNKNOWN');
  assert.equal((await handler(request('checkout', input))).status, 409);
  assert.equal((await handler(request('checkout', { ...input, attemptId: 'RF-ATTEMPT-003' }))).status, 409);
  assert.equal(calls, 1);
});

test('malformed order economics are rejected before persistence or provider calls', async () => {
  const { handler, store } = fixture(async () => { throw Error('must not call'); });
  for (const patch of [{ amountMinor: -1 }, { amountMinor: 1.5 }, { amountMinor: '12345' }, { currency: 'USD' },
    { attemptId: 'invalid' }, { orderCode: 'invalid' }, { payer: [] }])
    assert.equal((await handler(request('checkout', { ...input, ...patch }))).status, 400);
  assert.equal(store.rows.size, 0);
});

test('forged Tap webhooks cannot trigger a status lookup or change an attempt', async () => {
  let calls = 0;
  const { handler } = fixture(async () => { calls++; return json(charge()); });
  const payload = charge('CAPTURED');
  assert.equal((await handler(request('webhook', payload, false, { hashstring: '0'.repeat(64) }))).status, 401);
  assert.equal(calls, 0);
});

test('verified capture requires authenticated status and notifies the site with a signed result', async () => {
  let posts = 0;
  const { handler, store } = fixture(async (url, init) => {
    if (String(url).startsWith('https://api.tap.company/')) return json(charge(init.method === 'POST' ? 'INITIATED' : 'CAPTURED'));
    posts++; assert.equal(url, 'https://rfrf.example/api/payments/tap/webhook');
    const expected = createHmac('sha256', env.SUPABASE_SERVICE_ROLE_KEY)
      .update(`${init.headers['x-rafraf-timestamp']}.${init.body}`).digest('hex');
    assert.equal(init.headers['x-rafraf-signature'], expected);
    assert.equal(JSON.parse(init.body).outcome, 'CAPTURED');
    return json({ ok: true });
  });
  await handler(request('checkout', input));
  const payload = charge('CAPTURED');
  for (let i = 0; i < 2; i++) assert.equal((await handler(request('webhook', payload, false, { hashstring: signature(payload) }))).status, 200);
  assert.equal(store.rows.get(input.attemptId).state, 'CAPTURED');
  assert.ok(store.rows.get(input.attemptId).notified_at);
  assert.equal(posts, 1);
});

test('provider amount mismatch cannot mark a payment as captured even with a valid webhook signature', async () => {
  const { handler, store } = fixture(async (url, init) => json(charge(init.method === 'POST' ? 'INITIATED' : 'CAPTURED',
    init.method === 'POST' ? {} : { amount: 1 })));
  await handler(request('checkout', input));
  const payload = charge('CAPTURED');
  assert.equal((await handler(request('webhook', payload, false, { hashstring: signature(payload) }))).status, 503);
  assert.equal(store.rows.get(input.attemptId).state, 'PENDING');
});

test('failed delivery to the site is retried without losing the confirmed capture', async () => {
  let notifications = 0;
  const { handler, store } = fixture(async (url, init) => {
    if (String(url).startsWith('https://api.tap.company/')) return json(charge(init.method === 'POST' ? 'INITIATED' : 'CAPTURED'));
    return json({}, ++notifications === 1 ? 503 : 200);
  });
  await handler(request('checkout', input));
  const payload = charge('CAPTURED');
  assert.equal((await handler(request('webhook', payload, false, { hashstring: signature(payload) }))).status, 503);
  assert.equal(store.rows.get(input.attemptId).state, 'CAPTURED');
  assert.equal(store.rows.get(input.attemptId).notified_at, null);
  assert.equal((await handler(request('webhook', payload, false, { hashstring: signature(payload) }))).status, 200);
  assert.equal(notifications, 2);
});

test('status cannot move a captured attempt back to pending', async () => {
  let captured = true;
  const { handler, store } = fixture(async (url, init) => String(url).startsWith('https://api.tap.company/')
    ? json(charge(init.method === 'POST' ? 'INITIATED' : captured ? 'CAPTURED' : 'IN_PROGRESS')) : json({ ok: true }));
  await handler(request('checkout', input));
  const payload = charge('CAPTURED');
  await handler(request('webhook', payload, false, { hashstring: signature(payload) }));
  captured = false;
  assert.equal((await handler(request('status', { attemptId: input.attemptId }))).status, 503);
  assert.equal(store.rows.get(input.attemptId).state, 'CAPTURED');
});
