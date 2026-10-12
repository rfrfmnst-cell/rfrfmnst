const READ_INSERT_UPDATE = ['SELECT', 'INSERT', 'UPDATE'];
const READ_INSERT_DELETE = ['SELECT', 'INSERT', 'DELETE'];
const FULL_DML = [...READ_INSERT_UPDATE, 'DELETE'];
const APPEND = ['SELECT', 'INSERT'];
const READ = ['SELECT'];

export const APPEND_ONLY_TABLES = Object.freeze([
  'ai_decisions',
  'audit_logs',
  'escrow_ledger_entries',
  'landed_costs',
  'order_events',
  'provider_webhook_events',
  'rfq_evidence',
  'risk_assessments',
  'sourcing_candidates',
]);

export const DELETE_ALLOWED_TABLES = Object.freeze([
  'chat_messages',
  'customer_addresses',
  'customer_registration_intents',
  'customer_vehicles',
  'recommendation_results',
]);

const DELETE_AND_UPDATE_TABLES = [
  'chat_messages',
  'customer_addresses',
  'customer_vehicles',
];

const DELETE_WITHOUT_UPDATE_TABLES = [
  'customer_registration_intents',
  'recommendation_results',
];

const STATE_MUTABLE_TABLES = [
  'admin_mfa_verification_attempts',
  'ai_chat_runs',
  'chat_threads',
  'compliance_cases',
  'customers',
  'disputes',
  'invoices',
  'orders',
  'part_categories',
  'part_compatibilities',
  'part_numbers',
  'parts',
  'payment_refunds',
  'payments',
  'quotes',
  'rfq_items',
  'rfqs',
  'shipments',
  'source_registry',
  'sourcing_runs',
  'supplier_documents',
  'supplier_inventory',
  'supplier_payouts',
  'supplier_users',
  'supplier_warehouses',
  'suppliers',
  'users',
];

export const RUNTIME_TABLE_PRIVILEGES = Object.freeze({
  _prisma_migrations: READ,
  roles: READ,
  ...Object.fromEntries(
    STATE_MUTABLE_TABLES.map((table) => [table, READ_INSERT_UPDATE]),
  ),
  ...Object.fromEntries(
    DELETE_AND_UPDATE_TABLES.map((table) => [table, FULL_DML]),
  ),
  ...Object.fromEntries(
    DELETE_WITHOUT_UPDATE_TABLES.map((table) => [table, READ_INSERT_DELETE]),
  ),
  ...Object.fromEntries(APPEND_ONLY_TABLES.map((table) => [table, APPEND])),
});

export const FINANCIAL_DELETE_DENIED_TABLES = Object.freeze([
  'disputes',
  'escrow_ledger_entries',
  'invoices',
  'orders',
  'payment_refunds',
  'payments',
  'provider_webhook_events',
  'shipments',
  'supplier_payouts',
]);

const stable = (value) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );

export function isPostgresPermissionDenied(error) {
  if (!error || typeof error !== 'object') return false;
  const direct = 'code' in error ? error.code : undefined;
  const meta = 'meta' in error ? error.meta : undefined;
  const databaseCode =
    meta && typeof meta === 'object' && 'code' in meta ? meta.code : undefined;
  return direct === '42501' || databaseCode === '42501';
}

export function validateRuntimePrivilegeSnapshot(value) {
  const denied =
    !value ||
    value.role !== 'rafraf_app' ||
    value.superuser !== false ||
    value.createDb !== false ||
    value.createRole !== false ||
    value.inherit !== false ||
    value.bypassRls !== false ||
    value.databaseCreate !== false ||
    value.schemaCreate !== false ||
    !Array.isArray(value.memberships) ||
    value.memberships.length !== 0 ||
    !Array.isArray(value.ownedObjects) ||
    value.ownedObjects.length !== 0 ||
    !Array.isArray(value.executablePublicFunctions) ||
    value.executablePublicFunctions.length !== 0 ||
    stable(value.tablePrivileges ?? {}) !== stable(RUNTIME_TABLE_PRIVILEGES);
  if (denied) {
    throw new Error('Invalid least-privilege runtime snapshot');
  }
  return value;
}
