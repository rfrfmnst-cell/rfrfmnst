const ALLOWED_SESSION_STATUSES = new Set([
  'PENDING',
  'UNDER_REVIEW',
  'APPROVED',
  'LIMITED',
]);

export function supplierSessionStatusAllowed(status: string): boolean {
  return ALLOWED_SESSION_STATUSES.has(status);
}

export async function authorizeSupplierSession(
  token: string | undefined,
  verifyToken: (value: string | undefined) => Promise<string | null>,
  findSupplier: (supplierId: string) => Promise<{ status: string } | null>,
): Promise<string | null> {
  try {
    const supplierId = await verifyToken(token);
    if (!supplierId) return null;
    const supplier = await findSupplier(supplierId);
    return supplier && supplierSessionStatusAllowed(supplier.status)
      ? supplierId
      : null;
  } catch {
    // A database or verification failure must not authorize a stale cookie.
    return null;
  }
}
