import { describe, it, expect } from '@jest/globals';
import type { PoolConfig } from 'pg';
import {
  CORE_SCHEMA_SQL,
  CORE_TABLES,
  DatabaseReadinessService,
  validDatabaseConfiguration,
  type ProbeClient,
  type ProbePool,
} from './database-readiness';

const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  API_DATABASE_URL: 'postgresql://fixture@127.0.0.1/rafraf_api_test',
};

function fixture({
  missing = false,
  readable = true,
  readOnly = true,
  connectFailure = false,
  queryFailure = false,
} = {}) {
  const queries: { sql: string; values?: string[][] }[] = [];
  const configs: PoolConfig[] = [];
  let connections = 0,
    releases = 0,
    destroyed = false,
    closed = false;
  const client: ProbeClient = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (queryFailure && sql === CORE_SCHEMA_SQL)
        throw Error('private-provider-message');
      return {
        rows:
          sql === CORE_SCHEMA_SQL
            ? CORE_TABLES.slice(missing ? 1 : 0).map((name) => ({
                name,
                present: true,
                readable,
                read_only: readOnly,
              }))
            : [],
      };
    },
    release(destroy) {
      releases++;
      destroyed = Boolean(destroy);
    },
  };
  const pool: ProbePool = {
    async connect() {
      connections++;
      if (connectFailure) throw Error('private-connection-string');
      return client;
    },
    async end() {
      closed = true;
    },
  };
  const service = new DatabaseReadinessService((config) => {
    configs.push(config);
    return pool;
  });
  return {
    service,
    queries,
    configs,
    state: () => ({ connections, releases, destroyed, closed }),
  };
}

describe('database readiness is bounded, read-only and separate from liveness', () => {
  it('does not create a connection without an explicitly authorized API database URL', async () => {
    const f = fixture();
    expect(
      await f.service.check({
        NODE_ENV: 'test',
        DATABASE_URL: env.API_DATABASE_URL,
      }),
    ).toEqual({ ready: false, code: 'DATABASE_NOT_CONFIGURED' });
    expect(f.configs).toHaveLength(0);
  });

  it('rejects malformed and insecure remote connections without opening a pool', async () => {
    for (const value of [
      'not-a-url',
      'https://db.example/app',
      'postgresql://db.example/app',
      'postgresql://db.example/app?sslmode=require',
      'postgresql://db.example/app?sslmode=verify-full&ssl=false',
    ]) {
      const f = fixture();
      expect(
        await f.service.check({ NODE_ENV: 'test', API_DATABASE_URL: value }),
      ).toEqual({ ready: false, code: 'DATABASE_CONFIGURATION_INVALID' });
      expect(f.configs).toHaveLength(0);
    }
    expect(
      validDatabaseConfiguration(
        'postgresql://db.example/app?sslmode=verify-full',
      ),
    ).toBe(true);
  });

  it('uses one read-only transaction, parameterized table names and a one-connection pool', async () => {
    const f = fixture();
    expect(await f.service.check(env)).toEqual({
      ready: true,
      code: 'DATABASE_CORE_SCHEMA_READY',
    });
    expect(f.queries.map((query) => query.sql)).toEqual([
      'BEGIN READ ONLY',
      CORE_SCHEMA_SQL,
      'ROLLBACK',
    ]);
    expect(f.queries[1]?.values).toEqual([[...CORE_TABLES]]);
    expect(f.configs[0]).toMatchObject({
      max: 1,
      connectionTimeoutMillis: 2500,
      query_timeout: 2500,
    });
    expect(f.configs[0]?.options).toContain('default_transaction_read_only=on');
    expect(f.state()).toMatchObject({ releases: 1, destroyed: false });
  });

  it('does not treat an incomplete schema, denied reads or writable transaction as ready', async () => {
    for (const options of [
      { missing: true },
      { readable: false },
      { readOnly: false },
    ]) {
      const f = fixture(options);
      expect(await f.service.check(env)).toEqual({
        ready: false,
        code: 'DATABASE_SCHEMA_UNAVAILABLE',
      });
    }
  });

  it('reports connectivity failures without propagating credentials or provider errors', async () => {
    const f = fixture({ connectFailure: true });
    expect(await f.service.check(env)).toEqual({
      ready: false,
      code: 'DATABASE_UNAVAILABLE',
    });
    expect(f.state()).toMatchObject({ connections: 1, releases: 0 });
  });

  it('rolls back and discards a failed connection', async () => {
    const f = fixture({ queryFailure: true });
    expect(await f.service.check(env)).toEqual({
      ready: false,
      code: 'DATABASE_UNAVAILABLE',
    });
    expect(f.queries.at(-1)?.sql).toBe('ROLLBACK');
    expect(f.state()).toMatchObject({ releases: 1, destroyed: true });
  });

  it('coalesces concurrent probes and closes resources on shutdown', async () => {
    const f = fixture();
    const results = await Promise.all([
      f.service.check(env),
      f.service.check(env),
      f.service.check(env),
    ]);
    expect(results.every((result) => result.ready)).toBe(true);
    expect(f.state().connections).toBe(1);
    expect(f.configs).toHaveLength(1);
    await f.service.onModuleDestroy();
    expect(f.state().closed).toBe(true);
  });
});
