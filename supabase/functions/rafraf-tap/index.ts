import { createTapService } from '../_shared/tap-service.ts';
import { createAttemptStore } from '../_shared/tap-store.ts';

// Read the named bindings for each request instead of retaining a cold-start
// snapshot across a dashboard secret update. Never enumerate unrelated secrets.
const names = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TAP_SECRET_KEY',
  'TAP_MERCHANT_ID', 'TAP_MODE', 'TAP_CHECKOUT_ENABLED', 'TAP_LIVE_ENABLED', 'RAFRAF_SITE_ORIGIN'];
Deno.serve((request: Request) => {
  const env = Object.fromEntries(names.map(name => [name, Deno.env.get(name)]));
  const store = createAttemptStore(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);
  return createTapService({ env, store })(request);
});
