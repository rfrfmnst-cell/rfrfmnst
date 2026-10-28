import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import ts from 'typescript';
import * as otp from './customer-otp.ts';
import * as digits from './auth-input.ts';
import * as phone from './customer-phone.ts';

process.env.NODE_ENV = 'production';
process.env.SESSION_SECRET = 'test-only-customer-auth-flow-signing-key-12345';

// Execute the actual service with isolated database/provider adapters. No real
// database, messages, accounts or production credentials participate in tests.
function fixture({
  auditFailure = false,
  completionFailure = false,
  allowed = true,
} = {}) {
  const counts = new Map();
  let transactions = 0;
  const sends = [],
    checks = [];
  const tx = {
    $executeRaw: async () => {},
    auditLog: {
      count: async ({ where }) => counts.get(where.action) ?? 0,
      create: async ({ data }) => {
        counts.set(data.action, (counts.get(data.action) ?? 0) + 1);
      },
      createMany: async ({ data }) => {
        for (const d of data)
          counts.set(d.action, (counts.get(d.action) ?? 0) + 1);
      },
    },
    user: {
      findUnique: async () => ({
        id: 'user-fixture',
        isActive: allowed,
        role: { name: 'CUSTOMER' },
        customer: { id: 'customer-fixture' },
      }),
      update: async () => ({ customer: { id: 'customer-fixture' } }),
    },
  };
  const prisma = {
    $transaction: async (fn) => {
      transactions++;
      if (completionFailure && transactions === 2)
        throw Error('fixture persistence outage');
      return fn(tx);
    },
    auditLog: {
      create: async () => {
        if (auditFailure) throw Error('fixture audit outage');
      },
    },
  };
  const modules = {
    '@rafraf/db': { prisma },
    '@rafraf/shared/security/otp-request-quota': {
      OtpQuotaExceededError: class extends Error {},
      reserveOtpRequestQuota: async () => {},
    },
    '@rafraf/shared/security/turnstile': {
      verifyTurnstileToken: async () => ({ ok: true }),
    },
    '@rafraf/shared/twilio-verify': {
      twilioVerifyConfigured: () => true,
      twilioVerifyReady: async () => true,
      sendTwilioVerification: async (number) => {
        sends.push(number);
        return true;
      },
      checkTwilioVerification: async (number, code) => {
        checks.push({ number, code });
        return code === '123456' ? 'approved' : 'pending';
      },
    },
    './auth-input': digits,
    './customer-phone': phone,
    './customer-otp': otp,
    './customer-profile': { PLACEHOLDER_CUSTOMER_NAME: 'Fixture' },
    './customer-registration-proof': {
      createCustomerRegistrationProof: () => 'fixture-proof',
    },
    './session': { CUSTOMER_SESSION_TTL_SECONDS: 365 * 24 * 60 * 60 },
    './turnstile-quota': {
      reserveCustomerTurnstileSiteverify: async () => 'reserved',
    },
    './customer-password-auth-service': {},
    './customer-registration-service': {},
    './customer-google-auth-service': {},
  };
  const source = readFileSync(
    new URL('./customer-auth-service.ts', import.meta.url),
    'utf8',
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const moduleRef = { exports: {} };
  new Function('require', 'module', 'exports', 'console', compiled)(
    (name) => {
      assert.ok(name in modules, 'Unexpected real dependency ' + name);
      return modules[name];
    },
    moduleRef,
    moduleRef.exports,
    { error: () => {} },
  );
  return { service: moduleRef.exports, sends, checks, counts };
}

test('customer SMS flow uses one canonical phone and normalized Arabic OTP', async () => {
  const f = fixture();
  const sent = await f.service.requestCustomerOtpFlow(
    '٠٥١٢٣٤٥٦٧٨',
    'fixture-human-token',
    'fixture-ip',
  );
  assert.equal(sent.status, 'sent');
  assert.deepEqual(f.sends, ['+966512345678']);
  assert.equal(
    (await f.service.verifyCustomerOtpFlow(sent.challengeCookie, '١٢٣٤٥٦'))
      .status,
    'verified',
  );
  assert.deepEqual(f.checks, [{ number: '+966512345678', code: '123456' }]);
  assert.equal(
    (await f.service.verifyCustomerOtpFlow(sent.challengeCookie, '123456'))
      .status,
    'used',
  );
});

test('customer audit failure cannot return a sent challenge or throw a page error', async () => {
  const f = fixture({ auditFailure: true });
  assert.deepEqual(
    await f.service.requestCustomerOtpFlow(
      '0512345678',
      'fixture-human-token',
      'fixture-ip',
    ),
    { status: 'unavailable' },
  );
});

test('customer completion failure cannot authorize the account or escape as an exception', async () => {
  const f = fixture({ completionFailure: true });
  const challenge = otp.createCustomerOtpChallenge('+966512345678');
  assert.deepEqual(
    await f.service.verifyCustomerOtpFlow(challenge.cookie, '123456'),
    { status: 'unavailable' },
  );
});

test('customer inactive account remains denied after a correct provider verification', async () => {
  const f = fixture({ allowed: false });
  const challenge = otp.createCustomerOtpChallenge('+966512345678');
  assert.equal(
    (await f.service.verifyCustomerOtpFlow(challenge.cookie, '123456')).status,
    'not_allowed',
  );
});

test('customer wrong OTP attempts still lock on the fifth attempt', async () => {
  const f = fixture();
  let cookie = otp.createCustomerOtpChallenge('+966512345678').cookie;
  for (let i = 1; i <= 5; i++) {
    const result = await f.service.verifyCustomerOtpFlow(cookie, '000000');
    assert.equal(result.status, i === 5 ? 'locked' : 'invalid');
    if (result.status === 'invalid') cookie = result.challengeCookie;
  }
});
