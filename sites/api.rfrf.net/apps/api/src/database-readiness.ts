import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolConfig } from 'pg';

export const DATABASE_POOL_FACTORY = Symbol('DATABASE_POOL_FACTORY');
export const CORE_TABLES = [
  'users',
  'customers',
  'suppliers',
  'rfqs',
  'quotes',
  'orders',
] as const;

interface TableCheck {
  name: string;
  present: boolean;
  readable: boolean;
  read_only: boolean;
}
export interface ProbeClient {
  query(sql: string, values?: string[][]): Promise<{ rows: TableCheck[] }>;
  release(destroy?: boolean): void;
}
export interface ProbePool {
  connect(): Promise<ProbeClient>;
  end(): Promise<void>;
}
export type PoolFactory = (config: PoolConfig) => ProbePool;
export type DatabaseReadiness =
  | { ready: true; code: 'DATABASE_CORE_SCHEMA_READY' }
  | {
      ready: false;
      code:
        | 'DATABASE_NOT_CONFIGURED'
        | 'DATABASE_CONFIGURATION_INVALID'
        | 'DATABASE_UNAVAILABLE'
        | 'DATABASE_SCHEMA_UNAVAILABLE';
    };

export const CORE_SCHEMA_SQL = `
SELECT name,
       to_regclass('public.' || quote_ident(name)) IS NOT NULL AS present,
       COALESCE(has_table_privilege(current_user,
         to_regclass('public.' || quote_ident(name)), 'SELECT'), false) AS readable,
       current_setting('transaction_read_only') = 'on' AS read_only
FROM unnest($1::text[]) AS required(name)`;

export function createProbePool(config: PoolConfig): ProbePool {
  const pool = new Pool(config);
  // An idle connection can fail between probes. pg removes it from the pool;
  // the next probe reports its own result, without an unhandled process error.
  pool.on('error', () => {});
  return pool;
}

export function validDatabaseConfiguration(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      url.pathname.length < 2 ||
      url.hash
    )
      return false;
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    // Never disable certificate verification for a remote database. CA trust
    // may be supplied through the platform's normal Node TLS configuration.
    return (
      local ||
      (url.searchParams.get('sslmode') === 'verify-full' &&
        !url.searchParams.has('ssl'))
    );
  } catch {
    return false;
  }
}

@Injectable()
export class DatabaseReadinessService implements OnModuleDestroy {
  private pool?: ProbePool;
  private inFlight?: Promise<DatabaseReadiness>;

  constructor(
    @Inject(DATABASE_POOL_FACTORY) private readonly factory: PoolFactory,
  ) {}

  check(env: NodeJS.ProcessEnv = process.env): Promise<DatabaseReadiness> {
    // Deliberately require a separately authorized, read-only connection. Do
    // not silently reuse a BFF's DATABASE_URL or a Supabase service-role key.
    const connectionString = env.API_DATABASE_URL?.trim();
    if (!connectionString)
      return Promise.resolve({ ready: false, code: 'DATABASE_NOT_CONFIGURED' });
    if (!validDatabaseConfiguration(connectionString))
      return Promise.resolve({
        ready: false,
        code: 'DATABASE_CONFIGURATION_INVALID',
      });
    try {
      this.pool ??= this.factory({
        connectionString,
        max: 1,
        connectionTimeoutMillis: 2500,
        idleTimeoutMillis: 10000,
        allowExitOnIdle: true,
        query_timeout: 2500,
        options:
          '-c default_transaction_read_only=on -c statement_timeout=2000 -c lock_timeout=1000',
      });
      // Concurrent monitoring requests share one bounded probe.
      this.inFlight ??= this.probe(this.pool).finally(() => {
        this.inFlight = undefined;
      });
      return this.inFlight;
    } catch {
      return Promise.resolve({ ready: false, code: 'DATABASE_UNAVAILABLE' });
    }
  }

  private async probe(pool: ProbePool): Promise<DatabaseReadiness> {
    let client: ProbeClient | undefined;
    let destroy = false;
    try {
      client = await pool.connect();
      await client.query('BEGIN READ ONLY');
      const { rows } = await client.query(CORE_SCHEMA_SQL, [[...CORE_TABLES]]);
      const ready = CORE_TABLES.every((name) =>
        rows.some(
          (row) =>
            row.name === name && row.present && row.readable && row.read_only,
        ),
      );
      return ready
        ? { ready: true, code: 'DATABASE_CORE_SCHEMA_READY' }
        : { ready: false, code: 'DATABASE_SCHEMA_UNAVAILABLE' };
    } catch {
      destroy = true;
      return { ready: false, code: 'DATABASE_UNAVAILABLE' };
    } finally {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {
          destroy = true;
        }
        client.release(destroy);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.inFlight;
    await this.pool?.end();
  }
}
