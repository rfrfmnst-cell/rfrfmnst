import { createTapService } from '../_shared/tap-service.ts';
import { createAttemptStore } from '../_shared/tap-store.ts';

const env = Deno.env.toObject();
const store = createAttemptStore(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);
Deno.serve(createTapService({ env, store }));
