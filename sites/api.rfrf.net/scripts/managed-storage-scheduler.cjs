'use strict';

const { Server } = require('node:http');
const SURFACE = 'api';

function scheduleStorageProbe({
  getHandles = () => process._getActiveHandles(),
  loadReporter = () => import('./managed-storage-startup-probe.mjs'),
  output = (line) => process.stdout.write(line),
  now = () => new Date(),
  uid = () => typeof process.getuid === 'function' ? process.getuid() : null,
  defer = setImmediate,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const deadline = now().getTime() + 5000;
  let finished = false;
  let timer;
  function fixedFailure(code) {
    try {
      let value = null;
      try { value = uid(); } catch {}
      output(`${JSON.stringify({
        timestamp: now().toISOString(), level: 'warn',
        message: JSON.stringify({
          event: 'rafraf.managed_storage_probe', surface: SURFACE, code,
          uid: Number.isSafeInteger(value) && value >= 0 ? value : null,
        }),
      })}\n`);
    } catch {
      // A diagnostic logger failure must not stop the already-started application.
    }
  }
  async function runProbe() {
    let reporter;
    try {
      reporter = await loadReporter();
      if (typeof reporter?.reportStorage !== 'function') throw new Error('Invalid reporter');
    } catch {
      fixedFailure('PROBE_MODULE_LOAD_FAILURE');
      return;
    }
    try {
      await reporter.reportStorage();
    } catch {
      fixedFailure('PROBE_REPORT_FAILURE');
    }
  }
  function observe() {
    if (finished) return;
    let listening;
    try {
      listening = getHandles().some((handle) => handle instanceof Server && handle.listening === true);
    } catch {
      finished = true;
      fixedFailure('LISTEN_OBSERVATION_FAILURE');
      return;
    }
    if (listening) {
      finished = true;
      void runProbe().catch(() => {});
      return;
    }
    if (now().getTime() >= deadline) {
      finished = true;
      fixedFailure('LISTEN_OBSERVATION_TIMEOUT');
      return;
    }
    timer = setTimer(observe, 100);
    timer?.unref?.();
  }
  const immediate = defer(observe);
  immediate?.unref?.();
  return {
    cancel() { finished = true; if (timer) clearTimer(timer); },
  };
}

module.exports = { scheduleStorageProbe };
