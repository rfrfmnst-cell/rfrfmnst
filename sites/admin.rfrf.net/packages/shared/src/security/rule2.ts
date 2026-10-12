/**
 * Rule 2 enforcement — runtime guard.
 * Source of truth: docs/BUSINESS_RULES.md Rule 2 (and CLAUDE.md non-negotiables).
 *
 * The customer may see: final price, part price (bundled), shipping (bundled),
 * warranty, tax. The customer may NEVER see supplier cost, margin, fees, risk
 * buffer, or supplier identity. Suppliers may see their own pricing but never
 * the platform's margin, nor any competitor's data.
 *
 * These are pure functions with no I/O so they can be called from a Server
 * Action, a Nest interceptor, or a test without any wiring.
 */

export type Audience = 'CUSTOMER' | 'SUPPLIER' | 'ADMIN';

/**
 * Cost components that reveal what Rafraf paid or earned. Exposing any of these
 * to a customer lets them derive supplier cost or margin, which Rule 2 forbids.
 * `totalLandedCost` is deliberately absent: it equals the customer's final
 * price and is safe to show.
 */
export const COST_INTERNAL_FIELDS = [
  'internalCostBreakdown',
  'supplierPrice',
  'platformMargin',
  'riskBuffer',
  'netProfit',
  'customsEstimate',
  'complianceCost',
  'inspectionFee',
  'paymentFee',
  'packagingFee',
  'localShipping',
  'intlShipping',
] as const;

/**
 * Margin-bearing fields a supplier must never see. A supplier legitimately
 * knows its own `supplierPrice`, so that one is not forbidden for them.
 */
export const MARGIN_FIELDS = [
  'internalCostBreakdown',
  'platformMargin',
  'riskBuffer',
  'netProfit',
] as const;

/**
 * Supplier identity must not reach the customer — Rafraf is the counterparty.
 * (This is the leak closed in commit "security: close supplier-name leak".)
 */
export const SUPPLIER_IDENTITY_FIELDS = [
  'supplierName',
  'supplierNameAr',
  'supplierLegalName',
  'supplierContact',
] as const;

/** Fields forbidden for a given audience. ADMIN sees everything (Rule 3). */
export function forbiddenFieldsFor(audience: Audience): readonly string[] {
  switch (audience) {
    case 'CUSTOMER':
      return [...COST_INTERNAL_FIELDS, ...SUPPLIER_IDENTITY_FIELDS];
    case 'SUPPLIER':
      return MARGIN_FIELDS;
    case 'ADMIN':
      return [];
  }
}

/**
 * Deep-walks a payload and returns the dotted path of every forbidden key.
 * Returns [] when the payload is safe for that audience.
 */
export function findInternalFieldLeaks(
  payload: unknown,
  audience: Audience,
): string[] {
  const forbidden = new Set(forbiddenFieldsFor(audience));
  if (forbidden.size === 0) return [];

  const leaks: string[] = [];
  const seen = new WeakSet<object>();

  const walk = (node: unknown, path: string): void => {
    if (node === null || typeof node !== 'object') return;
    if (seen.has(node)) return; // tolerate cycles
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${path}[${i}]`));
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      const childPath = path ? `${path}.${key}` : key;
      if (forbidden.has(key)) leaks.push(childPath);
      walk(value, childPath);
    }
  };

  walk(payload, '');
  return leaks;
}

/** True when the payload carries nothing this audience is forbidden to see. */
export function isSafeFor(payload: unknown, audience: Audience): boolean {
  return findInternalFieldLeaks(payload, audience).length === 0;
}

/**
 * Throws if the payload would leak internal data to this audience. Call this
 * immediately before returning any payload to a customer or supplier.
 */
export function assertNoInternalFieldLeaks(
  payload: unknown,
  audience: Audience,
): void {
  const leaks = findInternalFieldLeaks(payload, audience);
  if (leaks.length > 0) {
    throw new Error(
      `Rule 2 violation: ${audience} payload exposes internal field(s): ${leaks.join(', ')}`,
    );
  }
}

/**
 * Guards a supplier-scoped read. `rows` must already be filtered by supplierId
 * in the query; this catches the case where the filter was forgotten and a
 * competitor's row came back.
 */
export function assertOwnedBySupplier<T extends { supplierId?: string | null }>(
  rows: readonly T[],
  supplierId: string,
): void {
  const foreign = rows.filter(
    (row) => row.supplierId != null && row.supplierId !== supplierId,
  );
  if (foreign.length > 0) {
    throw new Error(
      `Competitor data leak: ${foreign.length} row(s) not owned by supplier ${supplierId}`,
    );
  }
}
