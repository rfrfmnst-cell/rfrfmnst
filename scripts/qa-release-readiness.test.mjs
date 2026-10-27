import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RELEASE_TARGETS, expectedRelease, assessReleaseTarget, checkReleaseTarget, connectionIssue, runReleaseReview } from './qa-release-readiness.mjs';

const api = RELEASE_TARGETS.find(target => target.service === 'rafraf-api');
const tap = RELEASE_TARGETS.find(target => target.service === 'rafraf-tap');
const oto = RELEASE_TARGETS.find(target => target.service === 'rafraf-oto');
const sha = 'b9ea7f63156934b34cc53fa4f82c7fdc077fc266';

test('deployment coverage includes all four applications and both integration brokers', () => {
  assert.equal(RELEASE_TARGETS.filter(item => item.kind === 'application').length, 4);
  assert.equal(RELEASE_TARGETS.filter(item => item.kind === 'integration').length, 2);
});
test('API 404 fails deployment acceptance even when the other sites are healthy', () => {
  assert.equal(assessReleaseTarget(api, 404, {}).issue, 'HTTP_404');
});
test('wrong service and missing release fail even on HTTP200', () => {
  assert.equal(assessReleaseTarget(api, 200, { service: 'rafraf-customer', status: 'alive', release: sha }).passed, false);
  assert.equal(assessReleaseTarget(api, 200, { service: 'rafraf-api', status: 'alive', release: null }).passed, false);
});
test('release verification accepts the published 12-character SHA and rejects stale or weak identities', () => {
  const payload = { service: 'rafraf-api', status: 'alive', release: sha.slice(0, 12) };
  assert.equal(assessReleaseTarget(api, 200, payload, sha).passed, true);
  assert.equal(assessReleaseTarget(api, 200, { ...payload, release: '795d4d5121f7' }, sha).issue, 'RELEASE_MISMATCH');
  assert.equal(assessReleaseTarget(api, 200, { ...payload, release: sha.slice(0, 7) }, sha).passed, false);
  assert.throws(() => expectedRelease('main'));
  assert.throws(() => expectedRelease('0'.repeat(40)));
  assert.equal(expectedRelease(sha.toUpperCase()), sha);
});
test('a healthy Tap broker without credentials remains blocked and reports names only', () => {
  const result = assessReleaseTarget(tap, 200, { service: 'rafraf-tap', ok: true,
    configuration: { secretPresent: false, merchantPresent: false, modeValid: false } });
  assert.equal(result.passed, false);
  assert.deepEqual(result.missingSettings, ['TAP_SECRET_KEY', 'TAP_MERCHANT_ID', 'TAP_MODE']);
  assert.equal(JSON.stringify(result).includes('configuration'), false);
});
test('credential presence does not hide a key-mode mismatch', () => {
  const result = assessReleaseTarget(tap, 200, { service: 'rafraf-tap', ok: true,
    configuration: { secretPresent: true, merchantPresent: true, modeValid: true, secretModeMatches: false, merchantFormatValid: true } });
  assert.equal(result.passed, false); assert.deepEqual(result.invalidChecks, ['secretModeMatches']);
});
test('OTO activation and both shipment guards must be verified alongside the token', () => {
  const result = assessReleaseTarget(oto, 200, { service: 'rafraf-oto', ok: true,
    configuration: { tokenPresent: true, enabled: false, automaticShipmentDisabled: false, configured: false } });
  assert.deepEqual(result.missingSettings, ['OTO_ENABLED', 'OTO_AUTO_CREATE_SHIPMENT', 'SHIPMENT_AUTO_CREATE']);
  assert.equal(result.passed, false);
});
test('complete broker configuration passes only the configuration-level check', () => {
  assert.equal(assessReleaseTarget(oto, 200, { service: 'rafraf-oto', ok: true,
    configuration: { tokenPresent: true, enabled: true, automaticShipmentDisabled: true, configured: true } }).passed, true);
});
test('DNS, TLS, timeouts and refused connections have distinct diagnostics', () => {
  assert.equal(connectionIssue(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } })), 'DNS_LOOKUP_FAILED');
  assert.equal(connectionIssue({ cause: { code: 'CERT_HAS_EXPIRED' } }), 'TLS_VERIFICATION_FAILED');
  assert.equal(connectionIssue({ errors: [{ code: 'ECONNREFUSED' }] }), 'CONNECTION_REFUSED');
  assert.equal(connectionIssue({ name: 'TimeoutError' }), 'CONNECTION_TIMEOUT');
  const cycle = {}; cycle.cause = cycle;
  assert.equal(connectionIssue(cycle), 'CONNECTION_FAILED');
});
test('invalid or oversized HTTP200 responses cannot pass as health', async () => {
  for (const value of ['<html>placeholder</html>', 'x'.repeat(65537)]) {
    const result = await checkReleaseTarget(api, { send: async () => new Response(value) });
    assert.equal(result.passed, false); assert.match(result.issue, /^JSON_RESPONSE_/);
  }
});
test('release probes use read-only fixed destinations and reject redirects', async () => {
  const result = await checkReleaseTarget(api, { release: sha, send: async (url, init) => {
    assert.equal(url, api.url); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    assert.equal(init.body, undefined); assert.equal(init.headers.Authorization, undefined);
    return Response.json({ service: 'rafraf-api', status: 'alive', release: sha.slice(0, 12) });
  } });
  assert.equal(result.passed, true);
});

test('the complete report fails when only the fourth application is missing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rafraf-release-review-'));
  try {
    const report = await runReleaseReview({ directory, release: sha, send: async url => {
      const target = RELEASE_TARGETS.find(item => item.url === url);
      if (target === api) return new Response('not found', { status: 404 });
      if (target.kind === 'application') return Response.json({ service: target.service, status: 'alive', release: sha.slice(0, 12) });
      const configuration = Object.fromEntries([...Object.keys(target.bindings), ...target.validations].map(key => [key, true]));
      return Response.json({ service: target.service, ok: true, configuration });
    } });
    assert.equal(report.passed, false);
    assert.deepEqual(report.checks.filter(item => !item.passed).map(item => item.name), ['API']);
    const saved = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'));
    assert.equal(saved.checks.length, 6);
    assert.equal(saved.passed, false);
    assert.match(await readFile(join(directory, 'report.md'), 'utf8'), /HTTP_404/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
