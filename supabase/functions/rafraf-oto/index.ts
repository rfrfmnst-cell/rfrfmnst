import { createOtoService } from '../_shared/oto-service.ts';

const names = ['SUPABASE_SERVICE_ROLE_KEY', 'OTO_REFRESH_TOKEN', 'OTO_ENABLED',
  'OTO_AUTO_CREATE_SHIPMENT', 'SHIPMENT_AUTO_CREATE'];
Deno.serve((request: Request) => {
  const env = Object.fromEntries(names.map(name => [name, Deno.env.get(name)]));
  return createOtoService(env)(request);
});
