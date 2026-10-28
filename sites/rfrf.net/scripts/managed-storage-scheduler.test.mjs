import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const { scheduleStorageProbe } = require('./managed-storage-scheduler.cjs');

function fixture() {
  let clock = 0;
  let handles = [];
  const tasks = [];
  const calls = { loads: 0, reports: 0, unrefs: 0, logs: [] };
  const deps = {
    now: () => new Date(clock), uid: () => 1742, getHandles: () => handles,
    output: (line) => calls.logs.push(JSON.parse(line)),
    loadReporter: async () => { calls.loads++; return { reportStorage: async () => { calls.reports++; } }; },
    defer: (task) => { tasks.push(task); return { unref: () => calls.unrefs++ }; },
    setTimer: (task) => { tasks.push(task); return { unref: () => calls.unrefs++ }; },
    clearTimer: () => {},
  };
  const step = async (time = clock) => { clock = time; tasks.shift()?.(); await Promise.resolve(); await Promise.resolve(); };
  const listen = () => {
    const server = new Server();
    Object.defineProperty(server, 'listening', { value: true });
    handles = [server];
  };
  return { deps, calls, tasks, step, listen, setHandles: (value) => { handles = value; } };
}

test('entry requires original Next customer synchronously even when loaded by another module', async () => {
  const source = await readFile(new URL('./managed-web-bootstrap.cjs', import.meta.url), 'utf8');
  const order = [];
  runInNewContext(source, {
    require: (path) => {
      order.push(path);
      return { installManagedActionOrigin: () => order.push('origin-installed'), scheduleStorageProbe: () => order.push('scheduled') };
    },
    module: { parent: {} },
  });
  assert.deepEqual(order, ['./managed-action-origin.cjs', 'origin-installed', './apps/customer/server.js', './managed-storage-scheduler.cjs', 'scheduled']);
});

test('probe remains deferred and begins only after an HTTP Server is listening', async () => {
  const f = fixture();
  scheduleStorageProbe(f.deps);
  assert.equal(f.calls.loads, 0);
  await f.step();
  assert.equal(f.calls.loads, 0);
  f.listen();
  await f.step(100);
  assert.equal(f.calls.loads, 1);
  assert.equal(f.calls.reports, 1);
  assert.ok(f.calls.unrefs >= 2);
});

test('lookalike non-server handle cannot authorize a probe; deadline is bounded', async () => {
  const f = fixture();
  f.setHandles([{ listening: true }]);
  scheduleStorageProbe(f.deps);
  await f.step(5000);
  assert.equal(f.calls.loads, 0);
  assert.equal(JSON.parse(f.calls.logs[0].message).code, 'LISTEN_OBSERVATION_TIMEOUT');
  assert.equal(f.tasks.length, 0);
});

test('module load failure is sanitized without reading or stopping application', async () => {
  const f = fixture();
  f.listen();
  f.deps.loadReporter = async () => { throw new Error('private/path secret'); };
  scheduleStorageProbe(f.deps);
  await f.step();
  assert.equal(JSON.parse(f.calls.logs[0].message).code, 'PROBE_MODULE_LOAD_FAILURE');
  assert.ok(!JSON.stringify(f.calls.logs).includes('secret'));
  assert.equal(f.calls.reports, 0);
});

test('reporter failure is sanitized and logger failure is contained', async () => {
  const f = fixture();
  f.listen();
  f.deps.loadReporter = async () => ({ reportStorage: async () => { throw new Error('secret'); } });
  scheduleStorageProbe(f.deps);
  await f.step();
  assert.equal(JSON.parse(f.calls.logs[0].message).code, 'PROBE_REPORT_FAILURE');
  assert.ok(!JSON.stringify(f.calls.logs).includes('secret'));
  const g = fixture();
  g.deps.output = () => { throw new Error('logging unavailable'); };
  scheduleStorageProbe(g.deps);
  await g.step(5000);
});

test('cancellation leaves diagnostic unloaded', async () => {
  const f = fixture();
  const control = scheduleStorageProbe(f.deps);
  control.cancel();
  f.listen();
  await f.step();
  assert.equal(f.calls.loads, 0);
});
