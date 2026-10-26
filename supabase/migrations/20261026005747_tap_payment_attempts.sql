create table public.tap_payment_attempts (
  attempt_id text primary key check (attempt_id ~ '^RF-[A-Z0-9-]{3,96}$'),
  order_id text not null check (length(order_id) between 1 and 100),
  order_code text not null check (order_code ~ '^ORD-[A-Z0-9-]{3,96}$'),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 9007199254740991),
  currency text not null default 'SAR' check (currency = 'SAR'),
  mode text not null check (mode in ('sandbox','live')),
  merchant_id text not null check (merchant_id ~ '^[A-Za-z0-9_-]+$'),
  state text not null check (state in ('INITIATING','PENDING','UNKNOWN','CAPTURED','FAILED','CANCELLED')),
  charge_id text unique check (charge_id is null or charge_id ~ '^chg_[A-Za-z0-9_-]+$'),
  checkout_url text,
  last_error text,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- A pending, uncertain or captured payment reserves the order durably.
create unique index tap_payment_attempts_active_order
  on public.tap_payment_attempts(order_id, mode)
  where state in ('INITIATING','PENDING','UNKNOWN','CAPTURED');
alter table public.tap_payment_attempts enable row level security;
alter table public.tap_payment_attempts force row level security;
revoke all on public.tap_payment_attempts from public, anon, authenticated;
grant select, insert, update on public.tap_payment_attempts to service_role;
comment on table public.tap_payment_attempts is
  'Server-only Tap attempt journal; order authority stays in the Rafraf application. No card data or customer profiles.';

