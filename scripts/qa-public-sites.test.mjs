import test from 'node:test';
import assert from 'node:assert/strict';
import { assessResponse, checkPublicPage } from './qa-public-sites.mjs';

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

test('VIN check requires actual vehicle fields and the expected source', () => {
  const check = { kind: 'vin-lookup' };
  assert.equal(assessResponse(check, { status: 200, body: JSON.stringify({status:'decoded',source:'NHTSA vPIC',vehicle:{make:'HONDA',model:'Accord'}}) }), null);
  assert.ok(assessResponse(check, {status:200,body:JSON.stringify({status:'decoded',source:'NHTSA vPIC',vehicle:{}})}));
  assert.ok(assessResponse(check, {status:200,body:JSON.stringify({status:'available'})}));
});

test('response validation errors are surfaced instead of reported as connection failures', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('Hello', {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });

  try {
    await assert.rejects(
      checkPublicPage({ name: 'invalid check', url: 'https://rfrf.net/', kind: 'html', markers: null }),
      TypeError,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
