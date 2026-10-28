import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { describe, it, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { applyApiSecurity } from './../src/security';
import { randomBytes } from 'node:crypto';
import {
  DatabaseReadinessService,
  type DatabaseReadiness,
} from './../src/database-readiness';

describe('AppController (e2e)', () => {
  let app: INestApplication;
  const originalSecret = process.env.READINESS_PROBE_SECRET;
  let databaseChecks = 0;
  let databaseResult: DatabaseReadiness;

  beforeEach(async () => {
    delete process.env.READINESS_PROBE_SECRET;
    databaseChecks = 0;
    databaseResult = { ready: true, code: 'DATABASE_CORE_SCHEMA_READY' };
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DatabaseReadinessService)
      .useValue({
        check: async () => {
          databaseChecks++;
          return databaseResult;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    applyApiSecurity(app);
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    if (originalSecret === undefined) delete process.env.READINESS_PROBE_SECRET;
    else process.env.READINESS_PROBE_SECRET = originalSecret;
  });

  it('/ (GET)', () => {
    // `getHttpServer()` تُعيد `any`؛ نضيّقها إلى ما يقبله supertest بدل تمرير any.
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    return request(server).get('/').expect(200).expect('Hello World!');
  });

  it('serves liveness with security headers and without caching', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    await request(server)
      .get('/api/liveness')
      .expect(200)
      .expect('Cache-Control', 'no-store, max-age=0')
      .expect('X-Content-Type-Options', 'nosniff')
      .expect('Content-Security-Policy', "frame-ancestors 'none'");
  });

  it('grants browser access only to configured Rafraf origins', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    await request(server)
      .get('/api/liveness')
      .set('Origin', 'https://rfrf.net')
      .expect('Access-Control-Allow-Origin', 'https://rfrf.net');
    const denied = await request(server)
      .get('/api/liveness')
      .set('Origin', 'https://untrusted.example');
    // CORS is a browser policy; disallowed origins must get no grant.
    if (denied.headers['access-control-allow-origin']) {
      throw new Error('Unexpected cross-origin access grant');
    }
    if (denied.headers['x-powered-by']) {
      throw new Error('Unexpected server fingerprint');
    }
  });

  it('keeps readiness closed and makes no database request without configured probe authorization', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    await request(server)
      .get('/api/readiness')
      .expect(503)
      .expect({ ready: false, code: 'READINESS_NOT_CONFIGURED' });
    process.env.READINESS_PROBE_SECRET = randomBytes(32).toString('hex');
    await request(server).get('/api/readiness').expect(401);
    await request(server)
      .get('/api/readiness')
      .set('x-readiness-probe-secret', 'wrong')
      .expect(401);
    if (databaseChecks !== 0)
      throw Error('Unauthorized readiness queried the database');
    await request(server).get('/api/liveness').expect(200);
  });

  it('returns only a scoped readiness code after authenticated database verification', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const secret = randomBytes(32).toString('hex');
    process.env.READINESS_PROBE_SECRET = secret;
    await request(server)
      .get('/api/readiness')
      .set('x-readiness-probe-secret', secret)
      .expect(200)
      .expect('Cache-Control', 'no-store, max-age=0')
      .expect({
        ready: true,
        code: 'DATABASE_CORE_SCHEMA_READY',
        scope: 'database-connectivity-and-core-schema',
      });
    databaseResult = { ready: false, code: 'DATABASE_SCHEMA_UNAVAILABLE' };
    await request(server)
      .get('/api/readiness')
      .set('x-readiness-probe-secret', secret)
      .expect(503)
      .expect(databaseResult);
  });
});
