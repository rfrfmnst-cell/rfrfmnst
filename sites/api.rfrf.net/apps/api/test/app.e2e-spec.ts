import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { describe, it, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { applyApiSecurity } from './../src/security';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    applyApiSecurity(app);
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
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
});
