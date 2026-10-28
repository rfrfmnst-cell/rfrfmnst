import assert from 'node:assert/strict';
import test from 'node:test';
import { adminLandingPath } from './admin-landing-path.ts';

test('operations readers retain the operations landing page', () => {
  assert.equal(
    adminLandingPath(['OPERATIONS_READ', 'SUPPLIER_WRITE', 'RISK_REVIEW']),
    '/',
  );
});

test('supplier reviewers without operations access open their allowed page', () => {
  assert.equal(adminLandingPath(['SUPPLIER_WRITE']), '/suppliers');
});

test('risk reviewers without operations access open their allowed page', () => {
  assert.equal(adminLandingPath(['RISK_REVIEW']), '/exceptions');
});

test('combined supplier and risk reviewers receive a permitted landing page', () => {
  assert.equal(
    adminLandingPath(['SUPPLIER_WRITE', 'RISK_REVIEW']),
    '/suppliers',
  );
});

test('other permissions keep the existing fallback without granting access', () => {
  assert.equal(adminLandingPath(['PAYMENT_WRITE']), '/');
  assert.equal(adminLandingPath([]), '/');
});
