import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { normalizeSupplierPhone } from './supplier-phone.ts';
import { normalizeOtpCode } from './auth-input.ts';
import { authenticationCoreConfigured } from './auth-configuration.ts';
import {
  createSupplierOtpChallenge,
  parseSupplierOtpChallenge,
  verifySupplierOtpCode,
} from './supplier-otp.ts';
import { authorizeSupplierSession } from './session-access.ts';
import { signSession, verifySession } from './session-token.ts';

const phone = '+966512345678';
const arabic = (value) => value.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
const persian = (value) => value.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
process.env.NODE_ENV = 'production';
process.env.SESSION_SECRET =
  'test-only-supplier-session-secret-not-for-production';

test('supplier phone supports Arabic digits and international formats without truncated local numbers', () => {
  for (const input of [
    '0512345678',
    '966512345678',
    phone,
    '00966512345678',
    '05 123-456-78',
    arabic('0512345678'),
    persian('00966512345678'),
  ])
    assert.equal(normalizeSupplierPhone(input), phone, input);
  assert.equal(normalizeSupplierPhone('+15551234567'), '+15551234567');
  for (const input of [
    '051234',
    '05123456789',
    'abc0512345678',
    '+12',
    '0512345678x',
    '',
    null,
  ])
    assert.equal(normalizeSupplierPhone(input), null, String(input));
});

test('Arabic supplier OTP verifies the signed challenge; tampered and malformed codes fail', () => {
  const challenge = createSupplierOtpChallenge(phone);
  const parsed = parseSupplierOtpChallenge(challenge.cookie);
  assert.ok(parsed);
  for (const code of [
    challenge.code,
    arabic(challenge.code),
    persian(challenge.code),
  ])
    assert.equal(verifySupplierOtpCode(parsed, normalizeOtpCode(code)), true);
  for (const code of ['12345', '1234567', '12345x'])
    assert.equal(verifySupplierOtpCode(parsed, code), false);
  assert.equal(parseSupplierOtpChallenge(challenge.cookie + 'x'), null);
});

test('supplier session cannot grant access to suspended, missing or unreachable accounts', async () => {
  const token = await signSession('fixture-supplier');
  assert.equal(
    await authorizeSupplierSession(token, verifySession, async () => ({
      status: 'APPROVED',
    })),
    'fixture-supplier',
  );
  for (const status of ['SUSPENDED', 'REJECTED', 'INACTIVE'])
    assert.equal(
      await authorizeSupplierSession(token, verifySession, async () => ({
        status,
      })),
      null,
    );
  assert.equal(
    await authorizeSupplierSession(token + 'x', verifySession, async () => ({
      status: 'APPROVED',
    })),
    null,
  );
  assert.equal(
    await authorizeSupplierSession(token, verifySession, async () => null),
    null,
  );
  assert.equal(
    await authorizeSupplierSession(token, verifySession, async () => {
      throw Error('fixture database offline');
    }),
    null,
  );
});

test('supplier authentication remains unavailable without complete core configuration', () => {
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
      DATABASE_URL: 'postgresql://test.invalid/fixture',
      SESSION_SECRET: 'x'.repeat(40),
    }),
    true,
  );
});
