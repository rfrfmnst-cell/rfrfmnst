import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { TapHostedClient, tapConfigFromEnv, tapAmount, isTapCheckoutUrl, verifyTapChargeWebhook } from '../functions/_shared/tap-hosted.ts';

const config = { secretKey: 'sk_test_unit_fixture', merchantId: 'merchant_fixture', mode: 'sandbox' };
const input = {
  orderCode: 'RF-UNIT-ATTEMPT', money: { amount: '123.45', currency: 'SAR' },
  description: 'Rafraf order', payer: { firstName: 'Test', lastName: 'Customer',
    email: 'test@example.test', phone: '0501234567' },
  returnUrl: 'https://rfrf.example/track', notificationUrl: 'https://rfrf.example/api/payments/tap/webhook',
};
const charge = { id: 'chg_fixture', object: 'charge', live_mode: false,
  merchant: { id: config.merchantId }, reference: { order: input.orderCode, gateway: 'gateway', payment: 'payment' },
  amount: 123.45, currency: 'SAR', status: 'INITIATED',
  transaction: { created: '1792973653000', url: 'https://checkout.tap.company/session/fixture' } };
const expected = { id: charge.id, orderCode: input.orderCode, amount: '123.45', currency: 'SAR' };
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

test('configuration requires matching secret mode and explicit Rafraf merchant', () => {
  assert.equal(tapConfigFromEnv({}), null);
  assert.equal(tapConfigFromEnv({ TAP_MODE: 'live', TAP_SECRET_KEY: config.secretKey, TAP_MERCHANT_ID: config.merchantId }), null);
  assert.equal(tapConfigFromEnv({ TAP_MODE: 'sandbox', TAP_SECRET_KEY: config.secretKey }), null);
  assert.deepEqual(tapConfigFromEnv({ TAP_MODE: 'sandbox', TAP_SECRET_KEY: config.secretKey, TAP_MERCHANT_ID: config.merchantId }), config);
  assert.throws(() => new TapHostedClient({ ...config, mode: 'live' }));
});

test('money rejects rounding, invalid types and unsafe totals', () => {
  for (const bad of [0, -1, '', null, true, '1.001', '1e2', NaN, Infinity, '9007199254740992'])
    assert.throws(() => tapAmount(bad));
  assert.equal(tapAmount('001.2'), '1.20');
  assert.equal(tapAmount(123.45), '123.45');
});

test('hosted checkout uses server money, fixed endpoint, merchant and stable attempt idempotency', async () => {
  const calls = [];
  const client = new TapHostedClient(config, async (url, init) => { calls.push({ url, init }); return response(charge); });
  const result = await client.authorize(input);
  assert.equal(result.externalRef, 'chg_fixture');
  assert.equal(result.redirectUrl, charge.transaction.url);
  assert.equal(calls[0].url, 'https://api.tap.company/v2/charges/');
  assert.equal(calls[0].init.headers.authorization, `Bearer ${config.secretKey}`);
  assert.equal(calls[0].init.redirect, 'error');
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.amount, 123.45);
  assert.equal(payload.currency, 'SAR');
  assert.deepEqual(payload.merchant, { id: config.merchantId });
  assert.equal(payload.reference.idempotent, input.orderCode);
  assert.equal(payload.reference.order, input.orderCode);
  assert.equal(payload.source.id, 'src_all');
  assert.equal(payload.threeDSecure, true);
  assert.equal(payload.save_card, false);
  assert.deepEqual(payload.customer.phone, { country_code: '966', number: '501234567' });
  assert.equal(payload.card, undefined);
  assert.equal(payload.post.url, input.notificationUrl);
});

test('bad input fails before any provider request', async () => {
  let calls = 0;
  const client = new TapHostedClient(config, async () => { calls++; return response(charge); });
  for (const patch of [
    { money: { amount: '1.001', currency: 'SAR' } },
    { money: { amount: '123.45', currency: 'USD' } },
    { notificationUrl: 'http://other.example/webhook' },
    { returnUrl: 'http://rfrf.example/track' },
    { payer: { ...input.payer, phone: 'invalid' } },
    { orderCode: '../invalid' },
  ]) await assert.rejects(client.authorize({ ...input, ...patch }));
  assert.equal(calls, 0);
});

test('checkout rejects wrong amount, currency, reference, merchant, mode or redirect', async () => {
  for (const patch of [
    { amount: 124 }, { currency: 'USD' }, { reference: { order: 'other' } },
    { merchant: { id: 'other_merchant' } }, { live_mode: true },
    { transaction: { url: 'https://checkout.tap.company.evil.example/session' } },
    { status: 'CAPTURED' }, { id: 'bad' },
  ]) {
    const client = new TapHostedClient(config, async () => response({ ...charge, ...patch }));
    await assert.rejects(client.authorize(input));
  }
  for (const url of ['http://checkout.tap.company/x', 'https://user@checkout.tap.company/x', 'https://checkout.tap.company:8443/x', 'https://evil.example'])
    assert.equal(isTapCheckoutUrl(url), false);
});

test('authenticated status binds exact charge and server order economics', async () => {
  const client = new TapHostedClient(config, async (url, init) => {
    assert.equal(url, 'https://api.tap.company/v2/charges/chg_fixture');
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    return response({ ...charge, status: 'CAPTURED' });
  });
  assert.deepEqual(await client.status(expected), { ...expected, status: 'CAPTURED' });
  for (const patch of [{ id: 'chg_other' }, { amount: 1 }, { orderCode: 'other' }, { currency: 'USD' }])
    await assert.rejects(client.status({ ...expected, ...patch }));
});

test('unknown provider states cannot confirm payment', async () => {
  for (const state of ['REFUNDED', 'NEW_STATUS', 'toString', 'constructor', null]) {
    const client = new TapHostedClient(config, async () => response({ ...charge, status: state }));
    await assert.rejects(client.status(expected), { retryable: true });
  }
});

test('Tap signature uses documented canonical SAR amount and constant-time digest comparison', () => {
  const payload = { ...charge, status: 'CAPTURED' };
  const canonical = 'x_idchg_fixturex_amount123.45x_currencySARx_gateway_referencegatewayx_payment_referencepaymentx_statusCAPTUREDx_created1792973653000';
  const signature = createHmac('sha256', config.secretKey).update(canonical).digest('hex');
  assert.equal(verifyTapChargeWebhook(payload, signature, config), true);
  for (const patch of [{ amount: 1 }, { status: 'FAILED' }, { live_mode: true }, { merchant: { id: 'other' } }])
    assert.equal(verifyTapChargeWebhook({ ...payload, ...patch }, signature, config), false);
  for (const bad of [null, '', 'invalid', '0'.repeat(64)])
    assert.equal(verifyTapChargeWebhook(payload, bad, config), false);
  // Signing raw JSON is a different contract and must not be accepted.
  assert.equal(verifyTapChargeWebhook(payload, createHmac('sha256', config.secretKey).update(JSON.stringify(payload)).digest('hex'), config), false);
});

test('uncertain network, JSON and provider failures stay retryable without disclosing response', async () => {
  for (const send of [async () => { throw Error('secret-provider-detail'); },
    async () => new Response('invalid JSON'), async () => response({ secret: 'private' }, 500)]) {
    await assert.rejects(new TapHostedClient(config, send).authorize(input), e => e.retryable && !e.message.includes('secret'));
  }
  await assert.rejects(new TapHostedClient(config, async () => response({}, 401)).authorize(input), { message: 'tap_http_401', retryable: false });
});
