import type { Attempt, AttemptState, AttemptStore } from './tap-service.ts';

/** Only the service role has table privileges; no customer-facing REST access. */
export function createAttemptStore(projectUrl: string, serviceKey: string, send: typeof fetch = fetch): AttemptStore {
  const base = new URL('/rest/v1/tap_payment_attempts', projectUrl);
  const headers = { 'content-type': 'application/json', apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`, prefer: 'return=representation' };
  async function request(method: string, query: URLSearchParams, body?: unknown) {
    const url = new URL(base); url.search = query.toString();
    return send(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
  }
  return {
    async insert(attempt) {
      const response = await request('POST', new URLSearchParams(), attempt);
      if (response.status === 409) return false;
      if (!response.ok) throw Error('attempt_insert_failed');
      return true;
    },
    async find(attemptId) {
      const response = await request('GET', new URLSearchParams({ attempt_id: `eq.${attemptId}`, select: '*', limit: '1' }));
      if (!response.ok) throw Error('attempt_lookup_failed');
      const rows = await response.json() as Attempt[];
      return rows[0] ?? null;
    },
    async update(attemptId: string, states: AttemptState[], patch: Partial<Attempt>) {
      const response = await request('PATCH', new URLSearchParams({ attempt_id: `eq.${attemptId}`, state: `in.(${states.join(',')})` }),
        { ...patch, updated_at: new Date().toISOString() });
      if (!response.ok) throw Error('attempt_update_failed');
    },
  };
}
