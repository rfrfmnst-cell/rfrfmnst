'use strict';
const ALLOWED_ORIGINS = new Set(['https://rfrf.net', 'https://supplier.rfrf.net']);

/** Next's TCP self-fetch origin is unreachable when the platform listens on a
 * Unix socket. Bind only that case to this deployment's fixed HTTPS origin.
 * No incoming host/header or user input can select the destination.
 */
function installManagedActionOrigin(origin, dependencies = {}) {
  if (!ALLOWED_ORIGINS.has(origin)) throw new Error('MANAGED_ACTION_ORIGIN_INVALID');
  const http = dependencies.http || require('node:http');
  const environment = dependencies.environment || process.env;
  const originalListen = http.Server.prototype.listen;
  function listen(...args) {
    // This bootstrap owns only the initial Next listener. Preserve any platform
    // listen wrapper and leave all later servers untouched.
    if (http.Server.prototype.listen === listen) http.Server.prototype.listen = originalListen;
    this.once('listening', () => {
      if (typeof this.address() === 'string') {
        environment.__NEXT_PRIVATE_ORIGIN = origin;
        try { (dependencies.output || console.info)(JSON.stringify({event:'rafraf.managed_action_origin',transport:'unix',origin})); } catch { /* Logging cannot prevent startup. */ }
      }
    });
    return Reflect.apply(originalListen, this, args);
  }
  http.Server.prototype.listen = listen;
}
module.exports = { installManagedActionOrigin };
