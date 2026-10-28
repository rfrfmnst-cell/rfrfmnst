import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import ts from 'typescript';
import * as otp from './supplier-otp.ts';
import * as digits from './auth-input.ts';
import * as phone from './supplier-phone.ts';
import * as access from './session-access.ts';
import * as session from './session-token.ts';

process.env.NODE_ENV = 'production';
process.env.SESSION_SECRET = 'test-only-supplier-auth-flow-signing-key-12345';

function fixture({
  auditFailure = false,
  completionFailure = false,
  status = 'APPROVED',
} = {}) {
  const counts = new Map(),
    cookies = new Map(),
    options = new Map();
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
      createMany: async () => {},
    },
    supplier: { findUnique: async () => ({ id: 'supplier-fixture', status }) },
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
    '@rafraf/db': { prisma, SupplierStatus: { PENDING: 'PENDING' } },
    '@rafraf/shared/security/otp-request-quota': {
      OtpQuotaExceededError: class extends Error {},
      reserveOtpRequestQuota: async () => {},
    },
    '@rafraf/shared/security/request-subject': {
      requestIpSubject: () => 'fixture-ip',
    },
    '@rafraf/shared/security/turnstile': {
      verifyTurnstileToken: async () => ({ ok: true }),
    },
    '@rafraf/shared/twilio-verify': {
      sendTwilioVerification: async (number) => {
        sends.push(number);
        return true;
      },
      checkTwilioVerification: async (number, code) => {
        checks.push({ number, code });
        return code === '123456' ? 'approved' : 'pending';
      },
    },
    'next/headers': {
      headers: async () => new Headers(),
      cookies: async () => ({
        get: (name) =>
          cookies.has(name) ? { value: cookies.get(name) } : undefined,
        set: (name, value, opts) => {
          cookies.set(name, value);
          options.set(name, opts);
        },
        delete: (name) => cookies.delete(name),
      }),
    },
    'next/navigation': {
      redirect: (path) => {
        throw Object.assign(new Error('fixture redirect'), {
          destination: path,
        });
      },
    },
    '../../lib/supplier-otp': otp,
    '../../lib/auth-input': digits,
    '../../lib/supplier-phone': phone,
    '../../lib/session-access.ts': access,
    '../../lib/session': session,
    '../../lib/supplier-otp-delivery': {
      supplierLocalOtpEnabled: () => false,
      supplierOtpAuditChannel: () => 'SMS',
      supplierOtpSecurityConfigured: () => true,
      supplierOtpSecurityReady: async () => true,
    },
    '../../lib/supplier-registration-draft': {
      SUPPLIER_REGISTRATION_COOKIE: 'fixture-registration',
      parseSupplierRegistrationDraft: () => null,
    },
    '../../lib/turnstile-quota': {
      reserveSupplierTurnstileSiteverify: async () => 'reserved',
    },
  };
  const source = readFileSync(
    new URL('../app/login/actions.ts', import.meta.url),
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
  return { actions: moduleRef.exports, cookies, options, sends, checks };
}
function form(input) {
  const f = new FormData();
  for (const [k, v] of Object.entries(input)) f.set(k, v);
  return f;
}
async function destination(operation) {
  try {
    await operation();
    assert.fail('Expected redirect');
  } catch (error) {
    assert.ok(error.destination, error.message);
    return error.destination;
  }
}

test('supplier OTP login accepts Arabic input, creates a secure session and prevents replay', async () => {
  const f = fixture();
  assert.equal(
    await destination(() =>
      f.actions.requestOtp(form({ phone: '٠٥١٢٣٤٥٦٧٨' })),
    ),
    '/login?mode=phone&step=verify',
  );
  assert.deepEqual(f.sends, ['+966512345678']);
  const challenge = f.cookies.get(otp.SUPPLIER_OTP_COOKIE);
  assert.equal(
    await destination(() => f.actions.verifyOtp(form({ code: '١٢٣٤٥٦' }))),
    '/',
  );
  assert.equal(
    await session.verifySession(f.cookies.get('sp_auth')),
    'supplier-fixture',
  );
  assert.equal(f.options.get('sp_auth').httpOnly, true);
  assert.equal(f.options.get('sp_auth').secure, true);
  f.cookies.set(otp.SUPPLIER_OTP_COOKIE, challenge);
  f.cookies.delete('sp_auth');
  assert.equal(
    await destination(() => f.actions.verifyOtp(form({ code: '123456' }))),
    '/login?mode=phone&err=used',
  );
  assert.equal(f.cookies.has('sp_auth'), false);
});

test('supplier audit outage redirects to unavailable without a session or unhandled page exception', async () => {
  const f = fixture({ auditFailure: true });
  assert.equal(
    await destination(() =>
      f.actions.requestOtp(form({ phone: '0512345678' })),
    ),
    '/login?mode=phone&err=unavailable',
  );
  assert.equal(f.cookies.has(otp.SUPPLIER_OTP_COOKIE), false);
  assert.equal(f.cookies.has('sp_auth'), false);
});

test('supplier completion outage never creates a session', async () => {
  const f = fixture({ completionFailure: true });
  f.cookies.set(
    otp.SUPPLIER_OTP_COOKIE,
    otp.createSupplierOtpChallenge('+966512345678').cookie,
  );
  assert.equal(
    await destination(() => f.actions.verifyOtp(form({ code: '123456' }))),
    '/login?mode=phone&err=unavailable',
  );
  assert.equal(f.cookies.has('sp_auth'), false);
});

test('supplier suspension and wrong OTPs preserve eligibility and attempt guards', async () => {
  const blocked = fixture({ status: 'SUSPENDED' });
  blocked.cookies.set(
    otp.SUPPLIER_OTP_COOKIE,
    otp.createSupplierOtpChallenge('+966512345678').cookie,
  );
  assert.equal(
    await destination(() =>
      blocked.actions.verifyOtp(form({ code: '123456' })),
    ),
    '/login?mode=phone&err=not_allowed',
  );
  assert.equal(blocked.cookies.has('sp_auth'), false);
  const f = fixture();
  f.cookies.set(
    otp.SUPPLIER_OTP_COOKIE,
    otp.createSupplierOtpChallenge('+966512345678').cookie,
  );
  for (let i = 1; i <= 5; i++)
    assert.equal(
      await destination(() => f.actions.verifyOtp(form({ code: '000000' }))),
      i === 5
        ? '/login?mode=phone&err=locked'
        : '/login?mode=phone&step=verify&err=invalid_otp',
    );
  assert.equal(f.cookies.has('sp_auth'), false);
});
