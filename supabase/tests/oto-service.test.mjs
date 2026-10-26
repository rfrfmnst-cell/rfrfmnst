import test from 'node:test';
import assert from 'node:assert/strict';
import { createOtoService } from '../functions/_shared/oto-service.ts';
import { createSupabaseOtoFulfillment } from '../../sites/admin.rfrf.net/apps/admin/lib/shipping/oto-supabase.ts';

const env = { SUPABASE_SERVICE_ROLE_KEY: 'unit-service-fixture', OTO_REFRESH_TOKEN: 'unit-refresh-fixture-1234',
  OTO_ENABLED: 'true', OTO_AUTO_CREATE_SHIPMENT: 'false', SHIPMENT_AUTO_CREATE: 'false' };
const req = (path, body = {}, key = env.SUPABASE_SERVICE_ROLE_KEY) => new Request(`https://fixture.supabase.co/functions/v1/rafraf-oto/${path}`,
  { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'x-rafraf-service-key': key } : {}) }, body: JSON.stringify(body) });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const rates = { originCity: 'Jeddah', destinationCity: 'Riyadh', weightKg: 3, currency: 'SAR', lengthCm: 20, widthCm: 15, heightCm: 10 };

test('OTO health reveals presence only and all operations require server credentials', async () => {
  let calls = 0; const handle = createOtoService(env, async () => { calls++; throw Error('not called'); });
  const response = await handle(new Request('https://fixture.supabase.co/functions/v1/rafraf-oto/health'));
  const data = await response.json(); assert.equal(data.configuration.configured, true);
  assert.equal(JSON.stringify(data).includes(env.OTO_REFRESH_TOKEN), false);
  for (const path of ['connection', 'rates', 'draft']) assert.equal((await handle(req(path, rates, 'wrong'))).status, 401);
  assert.equal(calls, 0);
});
test('OTO missing token or enabled automatic-shipment guards keep service closed', async () => {
  for (const patch of [{ OTO_REFRESH_TOKEN: '' }, { OTO_AUTO_CREATE_SHIPMENT: 'true' }, { SHIPMENT_AUTO_CREATE: 'true' }])
    assert.equal((await createOtoService({ ...env, ...patch })(req('rates', rates))).status, 503);
});
test('OTO connection verifies authentication and health without creating orders or shipments', async () => {
  const calls = [];
  const handle = createOtoService(env, async (url, init) => {
    calls.push(url);
    if (url.endsWith('refreshToken')) {
      assert.equal(JSON.parse(init.body).refresh_token, env.OTO_REFRESH_TOKEN);
      return json({ access_token: 'unit-access-token-123456' });
    }
    assert.equal(url, 'https://api.tryoto.com/rest/v2/healthCheck'); assert.equal(init.method, 'GET');
    return json({ success: true });
  });
  const response = await handle(req('connection')); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { connected: true, createsShipments: false });
  assert.equal(calls.length, 2);
});
test('OTO rates call only official authentication and quote endpoints', async () => {
  const calls = [];
  const handle = createOtoService(env, async (url, init) => {
    calls.push(url);
    if (url.endsWith('refreshToken')) return json({ access_token: 'unit-access-token-123456' });
    assert.equal(url, 'https://api.tryoto.com/rest/v2/checkOTODeliveryFee');
    const payload = JSON.parse(init.body); assert.equal(payload.originCity, 'Jeddah'); assert.equal(payload.weight, 3);
    assert.equal(init.redirect, 'error');
    return json({ success: true, deliveryCompany: [{ deliveryOptionId: 1, deliveryCompanyName: 'Test carrier', price: 25, currency: 'SAR' }] });
  });
  const r = await handle(req('rates', rates)); assert.equal(r.status, 200);
  const data = await r.json(); assert.equal(data.rates[0].price, 25); assert.equal(data.createsShipments, false);
  assert.equal(calls.length, 2);
});
test('OTO invalid dimensions and weight fail before any provider request', async () => {
  let calls = 0;
  const handle = createOtoService(env, async () => { calls++; throw Error('not called'); });
  for (const patch of [{ weightKg: -1 }, { weightKg: true }, { originCity: '' }, { lengthCm: -1 }])
    assert.equal((await handle(req('rates', { ...rates, ...patch }))).status, 400);
  assert.equal(calls, 0);
});
test('OTO draft preview forces paid zero-COD and createShipment false without submitting customer data', async () => {
  let calls = 0;
  const handle = createOtoService(env, async () => { calls++; throw Error('not called'); });
  const response = await handle(req('draft', { orderId: 'ORD-TEST-001', currency: 'SAR', amount: 100,
    packageCount: 1, packageWeight: 2, createShipment: true, amount_due: 100,
    customer: { name: 'Test customer', mobile: '966501234567', address: 'Test address', city: 'Riyadh', country: 'SA' },
    items: [{ name: 'Test part', sku: 'UNIT-001', price: 100, quantity: 1 }] }));
  assert.equal(response.status, 200); const { draft, submitted } = await response.json();
  assert.equal(draft.createShipment, false); assert.equal(draft.amount_due, 0); assert.equal(draft.payment_method, 'paid');
  assert.equal(submitted, false); assert.equal(calls, 0);
});
test('OTO authentication refusal does not expose provider data or a refresh token', async () => {
  const response = await createOtoService(env, async () => json({ message: 'private-provider-message' }, 401))(req('connection'));
  assert.equal(response.status, 502); assert.deepEqual(await response.json(), { error: 'oto_authentication_failed' });
});
test('admin quote bridge pins the Supabase project and authenticates only from the server', async () => {
  const bridgeEnv = { SUPABASE_URL: 'https://gfxnwfjjpxmzvnylushd.supabase.co', SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY };
  assert.equal(createSupabaseOtoFulfillment({ ...bridgeEnv, SUPABASE_URL: 'https://other.supabase.co' }), null);
  const bridge = createSupabaseOtoFulfillment(bridgeEnv, async (url, init) => {
    assert.equal(url, `${bridgeEnv.SUPABASE_URL}/functions/v1/rafraf-oto/rates`);
    assert.equal(init.headers['x-rafraf-service-key'], env.SUPABASE_SERVICE_ROLE_KEY);
    return json({ rates: [], createsShipments: false });
  });
  assert.deepEqual(await bridge.getRates(rates), []);
});
