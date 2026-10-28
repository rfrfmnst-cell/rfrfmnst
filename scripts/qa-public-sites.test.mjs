import test from 'node:test';
import assert from 'node:assert/strict';
import { assessResponse, diagnoseReview } from './qa-public-sites.mjs';

test('HTTP200 from the API on the customer domain is a failure', () => {
  assert.ok(assessResponse({ url: 'https://rfrf.net/api/liveness', kind: 'identity', service: 'rafraf-customer' }, { status: 200, body: '{"service":"rafraf-api","status":"alive"}' }));
});
test('valid service identity passes', () => {
  assert.equal(assessResponse({ kind: 'identity', service: 'rafraf-supplier' }, { status: 200, body: '{"service":"rafraf-supplier","status":"alive"}' }), null);
});
test('a placeholder HTML200 does not prove deployment', () => {
  assert.ok(assessResponse({ kind: 'html', markers: ['شركات قطع الغيار'] }, { status: 200, contentType: 'text/html', body: 'Hello World!' }));
});
test('same-origin login redirect is expected for the private catalog', () => {
  assert.equal(assessResponse({ kind: 'guest-guard', url: 'https://supplier.rfrf.net/catalog/import' }, { status: 307, location: '/login' }), null);
});
test('external or absent login redirects fail the authentication guard', () => {
  const check = { kind: 'guest-guard', url: 'https://supplier.rfrf.net/catalog/import' };
  assert.ok(assessResponse(check, { status: 307, location: 'https://example.org/login' }));
  assert.ok(assessResponse(check, { status: 200, location: null }));
});

test('malformed and credential-bearing login redirects are rejected without crashing review', () => {
  const check = { kind: 'guest-guard', url: 'https://supplier.rfrf.net/catalog/import' };
  assert.equal(assessResponse(check, { status: 307, location: 'https://[broken' }), 'عنوان تحويل الدخول غير صالح');
  assert.equal(assessResponse(check, { status: 307, location: 'http://[::1' }), 'عنوان تحويل الدخول غير صالح');
  assert.ok(assessResponse(check, { status: 307, location: 'https://user:pass@supplier.rfrf.net/login' }));
  assert.ok(assessResponse(check, { status: 307, location: 'https://supplier.rfrf.net.evil.example/login' }));
  assert.ok(assessResponse(check, { status: 307, location: 'javascript:alert(1)' }));
  assert.equal(assessResponse(check, { status: 307, location: '/login?next=%2Fcatalog%2Fimport' }), null);
});

test('VIN check requires actual vehicle fields and the expected source', () => {
  const check = { kind: 'vin-lookup' };
  assert.equal(assessResponse(check, { status: 200, body: JSON.stringify({status:'decoded',source:'NHTSA vPIC',vehicle:{make:'HONDA',model:'Accord'}}) }), null);
  assert.ok(assessResponse(check, {status:200,body:JSON.stringify({status:'decoded',source:'NHTSA vPIC',vehicle:{}})}));
  assert.ok(assessResponse(check, {status:200,body:JSON.stringify({status:'available'})}));
});

test('an across-host 403 outbreak is diagnosed but stays a failed review', () => {
  const checks = [
    { url: 'https://rfrf.net/', ok: false, status: 403 },
    { url: 'https://supplier.rfrf.net/login', ok: false, status: 403 },
    { url: 'https://admin.rfrf.net/login', ok: false, status: 403 },
  ];
  assert.equal(checks.every((check) => check.ok), false);
  assert.equal(diagnoseReview(checks).code, 'possible_shared_access_block');
  assert.match(diagnoseReview(checks).message, /HTTP 403/);
});

test('partial access denials and other failures retain distinct diagnoses', () => {
  const checks = [
    { url: 'https://rfrf.net/', ok: true, status: 200 },
    { url: 'https://supplier.rfrf.net/login', ok: false, status: 403 },
  ];
  assert.equal(diagnoseReview(checks).code, 'some_access_denied');
  assert.equal(diagnoseReview(checks.map((check) => ({ ...check, status: 502 }))).code, 'public_check_failures');
  assert.equal(diagnoseReview(checks.map((check) => ({ ...check, ok: true, status: 200 }))).code, 'healthy');
});

test('no checks cannot produce a healthy monitoring diagnosis', () => {
  assert.equal(diagnoseReview([]).code, 'no_checks');
});
