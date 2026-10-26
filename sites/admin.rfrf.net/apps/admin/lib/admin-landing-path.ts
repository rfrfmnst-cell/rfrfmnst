/** Choose an existing administrative page the operator can open after MFA. */
export function adminLandingPath(permissions: readonly string[]): string {
  if (permissions.includes('OPERATIONS_READ')) return '/';
  if (permissions.includes('SUPPLIER_WRITE')) return '/suppliers';
  if (permissions.includes('RISK_REVIEW')) return '/exceptions';
  return '/';
}
