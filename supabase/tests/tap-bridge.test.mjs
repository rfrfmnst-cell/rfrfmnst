import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { registerHooks } from 'node:module';

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@rafraf/shared/')) return { shortCircuit: true,
    url: new URL(`../../sites/rfrf.net/packages/shared/src/${specifier.slice('@rafraf/shared/'.length)}.ts`, import.meta.url).href };
  return next(specifier, context);
} });
const { TapSupabaseProvider, tapBridgeConfig, verifyTapBridgeNotification } =
  await import('../../sites/rfrf.net/apps/customer/lib/payments/tap-supabase-provider.ts');
const { tapPaymentLaunchStatus } = await import('../../sites/rfrf.net/apps/customer/lib/payments/tap-launch.ts');
const env = { SUPABASE_URL: 'https://gfxnwfjjpxmzvnylushd.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'unit-service-key',
  TAP_MODE: 'sandbox', PAYMENT_MODE: 'sandbox', CUSTOMER_PUBLIC_URL: 'https://rfrf.example', NODE_ENV: 'development' };
const config = tapBridgeConfig(env);
const reply = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

test('bridge uses only the selected Rafraf Supabase project and requires server credentials', () => {
  assert.equal(tapBridgeConfig({ ...env, SUPABASE_URL: 'https://other.supabase.co' }), null);
  assert.equal(tapBridgeConfig({ ...env, SUPABASE_SERVICE_ROLE_KEY: '' }), null);
  assert.equal(tapBridgeConfig({ ...env, TAP_MODE: 'invalid' }), null);
  assert.equal(config.projectUrl, env.SUPABASE_URL);
});
test('Tap launch permits configured sandbox previews and keeps live intake closed', () => {
  assert.equal(tapPaymentLaunchStatus(env).checkoutAllowed, true);
  assert.equal(tapPaymentLaunchStatus({ ...env, NODE_ENV: 'production' }).checkoutAllowed, false);
  assert.equal(tapPaymentLaunchStatus({ ...env, PAYMENT_MODE: 'live', TAP_MODE: 'live' }).checkoutAllowed, false);
  assert.equal(tapPaymentLaunchStatus({ ...env, SUPABASE_SERVICE_ROLE_KEY: '' }).checkoutAllowed, false);
});
test('internal notification signature binds raw bytes and expires after five minutes', () => {
  const now = Date.now(), timestamp = String(now), raw = '{"orderCode":"RF-UNIT"}';
  const signature = createHmac('sha256', env.SUPABASE_SERVICE_ROLE_KEY).update(`${timestamp}.${raw}`).digest('hex');
  assert.equal(verifyTapBridgeNotification(raw, timestamp, signature, env.SUPABASE_SERVICE_ROLE_KEY, now), true);
  assert.equal(verifyTapBridgeNotification(raw + ' ', timestamp, signature, env.SUPABASE_SERVICE_ROLE_KEY, now), false);
  assert.equal(verifyTapBridgeNotification(raw, timestamp, signature, env.SUPABASE_SERVICE_ROLE_KEY, now + 300001), false);
  assert.equal(verifyTapBridgeNotification(raw, timestamp, 'bad', env.SUPABASE_SERVICE_ROLE_KEY, now), false);
});
test('authorize forwards persisted order identity and server minor units to authenticated Supabase', async () => {
  const provider = new TapSupabaseProvider(config, async (url, init) => {
    assert.equal(url, `${env.SUPABASE_URL}/functions/v1/rafraf-tap/checkout`);
    assert.equal(init.headers['x-rafraf-service-key'], env.SUPABASE_SERVICE_ROLE_KEY);
    const payload = JSON.parse(init.body);
    assert.equal(payload.amountMinor, 12345); assert.equal(payload.orderId, 'order-1');
    assert.equal(payload.orderCode, 'ORD-001'); assert.equal(payload.attemptId, 'RF-ATTEMPT');
    return reply({ externalRef: 'chg_unit', redirectUrl: 'https://checkout.tap.company/session/unit' });
  });
  const result = await provider.authorize({ orderCode: 'RF-ATTEMPT', money: { amount: '123.45', currency: 'SAR' }, payer: {} },
    { id: 'order-1', code: 'ORD-001' });
  assert.equal(result.externalRef, 'chg_unit');
});
test('status maps declined states and rejects economics or mode changes from the bridge', async () => {
  const body = { attemptId: 'RF-ATTEMPT', externalRef: 'chg_unit', amountMinor: 12345, currency: 'SAR', mode: 'sandbox', outcome: 'FAILED' };
  assert.equal((await new TapSupabaseProvider(config, async () => reply(body)).status('RF-ATTEMPT', 'chg_unit', '123.45', 'SAR')).outcome, 'DECLINED');
  for (const patch of [{ amountMinor: 1 }, { mode: 'live' }, { externalRef: 'chg_other' }, { outcome: 'REFUNDED' }])
    await assert.rejects(new TapSupabaseProvider(config, async () => reply({ ...body, ...patch })).status('RF-ATTEMPT', 'chg_unit', '123.45', 'SAR'));
});
test('uncertain bridge failures remain retryable and refund does not silently succeed', async () => {
  const provider = new TapSupabaseProvider(config, async () => new Response('{}', { status: 503 }));
  await assert.rejects(provider.status('RF-ATTEMPT', 'chg_unit', '123.45', 'SAR'), { retryable: true });
  await assert.rejects(provider.refund({}), { message: 'tap_refund_not_enabled', retryable: true });
});
