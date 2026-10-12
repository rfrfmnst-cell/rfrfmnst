import { describe, it, expect } from '@jest/globals';
import {
  MIN_SECRET_LENGTH,
  WeakSessionSecretError,
  isUsableSecret,
  signSessionToken,
  timingSafeEqual,
  verifySessionToken,
} from './session-token';

const SECRET = 'a'.repeat(64);
const OTHER_SECRET = 'b'.repeat(64);
const DAY = 60 * 60 * 24;
const NOW = 1_760_000_000_000; // fixed clock so expiry assertions are exact

describe('session tokens — issuing', () => {
  it('round-trips a subject', async () => {
    const token = await signSessionToken(SECRET, 'cus_123', DAY, NOW);
    await expect(verifySessionToken(SECRET, token, NOW)).resolves.toBe(
      'cus_123',
    );
  });

  it('refuses a secret shorter than the minimum', async () => {
    await expect(
      signSessionToken('short', 'cus_123', DAY, NOW),
    ).rejects.toBeInstanceOf(WeakSessionSecretError);
    expect(isUsableSecret('x'.repeat(MIN_SECRET_LENGTH - 1))).toBe(false);
    expect(isUsableSecret('x'.repeat(MIN_SECRET_LENGTH))).toBe(true);
  });

  it('refuses a subject containing the delimiter', async () => {
    await expect(
      signSessionToken(SECRET, 'cus.123', DAY, NOW),
    ).rejects.toThrow(/contain no/);
  });

  it('refuses a non-positive ttl', async () => {
    await expect(signSessionToken(SECRET, 'cus_123', 0, NOW)).rejects.toThrow(
      /positive/,
    );
  });
});

describe('session tokens — forgery resistance', () => {
  it('rejects a token signed with a different secret', async () => {
    const token = await signSessionToken(OTHER_SECRET, 'cus_123', DAY, NOW);
    await expect(verifySessionToken(SECRET, token, NOW)).resolves.toBeNull();
  });

  it('rejects a token whose subject was swapped for another account', async () => {
    const token = await signSessionToken(SECRET, 'cus_victim', DAY, NOW);
    const [, exp, sig] = token.split('.');
    const forged = `cus_attacker.${exp}.${sig}`;
    await expect(verifySessionToken(SECRET, forged, NOW)).resolves.toBeNull();
  });

  it('rejects a token whose expiry was extended', async () => {
    const token = await signSessionToken(SECRET, 'cus_123', DAY, NOW);
    const [sub, exp, sig] = token.split('.');
    const forged = `${sub}.${Number(exp) + DAY * 365}.${sig}`;
    await expect(verifySessionToken(SECRET, forged, NOW)).resolves.toBeNull();
  });

  it('rejects a tampered signature', async () => {
    const token = await signSessionToken(SECRET, 'cus_123', DAY, NOW);
    const [sub, exp, sig] = token.split('.');
    const flipped = (sig[0] === '0' ? '1' : '0') + sig.slice(1);
    await expect(
      verifySessionToken(SECRET, `${sub}.${exp}.${flipped}`, NOW),
    ).resolves.toBeNull();
  });

  it('rejects the legacy two-part token format', async () => {
    await expect(
      verifySessionToken(SECRET, 'cus_123.deadbeef', NOW),
    ).resolves.toBeNull();
  });

  it('refuses to trust anything when the secret is missing or weak', async () => {
    const token = await signSessionToken(SECRET, 'cus_123', DAY, NOW);
    await expect(verifySessionToken(undefined, token, NOW)).resolves.toBeNull();
    await expect(verifySessionToken('', token, NOW)).resolves.toBeNull();
    await expect(verifySessionToken('short', token, NOW)).resolves.toBeNull();
  });

  it('returns null (never throws) on malformed input', async () => {
    for (const bad of ['', '...', 'a.b', 'a.b.c.d', 'a.notanumber.c']) {
      await expect(verifySessionToken(SECRET, bad, NOW)).resolves.toBeNull();
    }
    await expect(verifySessionToken(SECRET, undefined, NOW)).resolves.toBeNull();
  });
});

describe('session tokens — expiry is carried in the signed payload', () => {
  it('accepts the token one second before it expires', async () => {
    const token = await signSessionToken(SECRET, 'cus_123', DAY, NOW);
    const justBefore = NOW + DAY * 1000 - 1000;
    await expect(verifySessionToken(SECRET, token, justBefore)).resolves.toBe(
      'cus_123',
    );
  });

  it('rejects the token once it expires, even if the cookie survives', async () => {
    const token = await signSessionToken(SECRET, 'cus_123', DAY, NOW);
    const after = NOW + DAY * 1000 + 1000;
    await expect(verifySessionToken(SECRET, token, after)).resolves.toBeNull();
  });
});

describe('timingSafeEqual', () => {
  it('matches identical strings and rejects differing ones', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true);
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });
});
