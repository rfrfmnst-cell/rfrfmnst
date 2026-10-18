import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSaudiPhone } from './customer-phone.ts';
import { normalizeOtpCode } from './auth-input.ts';
import { authenticationCoreConfigured } from './auth-configuration.ts';
import {
  createCustomerOtpChallenge,
  parseCustomerOtpChallenge,
  verifyCustomerOtpCode,
} from './customer-otp.ts';
import { signSession, verifySession } from './session.ts';
import { safePostAuthPath } from './customer-auth-return-path.ts';

const phone = '+966512345678';
const arabic = (value) => value.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
const persian = (value) => value.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
process.env.NODE_ENV = 'production';
process.env.SESSION_SECRET =
  'test-only-client-session-secret-not-for-production';

test('Saudi phone formats share one canonical authentication identity', () => {
  for (const input of [
    '0512345678',
    '966512345678',
    phone,
    '00966512345678',
    '05 123-456-78',
    arabic('0512345678'),
    persian('00966512345678'),
  ])
    assert.equal(normalizeSaudiPhone(input), phone, input);
  for (const input of [
    '051234',
    '05123456789',
    '+96651234567',
    '+15551234567',
    'abc0512345678',
    '0512345678x',
    '',
    null,
  ])
    assert.equal(normalizeSaudiPhone(input), null, String(input));
});

test('Arabic OTP input verifies the same signed challenge without accepting changed digits', () => {
  const challenge = createCustomerOtpChallenge(phone);
  const parsed = parseCustomerOtpChallenge(challenge.cookie);
  assert.ok(parsed);
  for (const code of [
    challenge.code,
    arabic(challenge.code),
    persian(challenge.code),
  ])
    assert.equal(verifyCustomerOtpCode(parsed, normalizeOtpCode(code)), true);
  for (const code of [
    '12345',
    '1234567',
    '12345x',
    challenge.code.slice(0, 5) + 'x',
  ])
    assert.equal(verifyCustomerOtpCode(parsed, code), false);
  assert.equal(parseCustomerOtpChallenge(challenge.cookie + 'x'), null);
  assert.equal(parseCustomerOtpChallenge(undefined), null);
});

test('production authentication requires the original database and a strong session secret', () => {
  assert.equal(authenticationCoreConfigured({}), false);
  assert.equal(
    authenticationCoreConfigured({
      DATABASE_URL: 'postgresql://test.invalid/fixture',
      SESSION_SECRET: 'short',
    }),
    false,
  );
  assert.equal(
    authenticationCoreConfigured({
      DATABASE_URL: ' ',
      SESSION_SECRET: 'x'.repeat(40),
    }),
    false,
  );
  assert.equal(
    authenticationCoreConfigured({
      DATABASE_URL: 'postgresql://test.invalid/fixture',
      SESSION_SECRET: 'x'.repeat(40),
    }),
    true,
  );
});

test('signed customer session rejects tampering, expiry and a different signing key', async () => {
  const now = Date.now();
  const token = await signSession('fixture-customer', now);
  assert.equal(await verifySession(token, now), 'fixture-customer');
  assert.equal(await verifySession(token + 'x', now), null);
  assert.equal(
    await verifySession(token, now + 366 * 24 * 60 * 60 * 1000),
    null,
  );
  const secret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'different-test-only-signing-key-123456789';
  assert.equal(await verifySession(token, now), null);
  process.env.SESSION_SECRET = secret;
});

test('post-login destinations preserve customer paths and reject external redirects', () => {
  assert.equal(
    safePostAuthPath('/account/settings?tab=profile'),
    '/account/settings?tab=profile',
  );
  for (const value of [
    'https://example.org',
    '//example.org',
    '/\\example.org',
    '/login',
    '/account/../login',
  ])
    assert.equal(safePostAuthPath(value), '/chat');
});
