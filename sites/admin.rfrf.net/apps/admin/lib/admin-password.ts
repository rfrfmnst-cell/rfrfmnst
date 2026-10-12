/**
 * Password verification for named Rafraf operations users.
 *
 * Stored format: pbkdf2-sha512$<iterations>$<salt-base64url>$<digest-base64url>
 * Password creation belongs in the controlled operator-provisioning command;
 * this module intentionally only verifies supplied credentials.
 */
const MIN_PBKDF2_ITERATIONS = 210_000;
const MAX_PBKDF2_ITERATIONS = 2_000_000;
const encoder = new TextEncoder();

function base64UrlBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    Math.ceil(value.length / 4) * 4,
    '=',
  );

  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function timingSafeBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

export async function verifyAdminPassword(
  candidate: string,
  encodedHash: string | null | undefined,
): Promise<boolean> {
  if (!encodedHash) return false;

  const [algorithm, iterationsRaw, saltRaw, expectedRaw, ...extra] =
    encodedHash.split('$');
  if (
    extra.length > 0 ||
    algorithm !== 'pbkdf2-sha512' ||
    !/^[1-9]\d*$/.test(iterationsRaw ?? '')
  ) {
    return false;
  }

  const iterations = Number(iterationsRaw);
  const salt = saltRaw ? base64UrlBytes(saltRaw) : null;
  const expected = expectedRaw ? base64UrlBytes(expectedRaw) : null;
  if (
    !Number.isSafeInteger(iterations) ||
    iterations < MIN_PBKDF2_ITERATIONS ||
    iterations > MAX_PBKDF2_ITERATIONS ||
    !salt ||
    salt.length < 16 ||
    !expected ||
    expected.length !== 64
  ) {
    return false;
  }

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(candidate),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const derived = new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          hash: 'SHA-512',
          salt,
          iterations,
        },
        key,
        512,
      ),
    );
    return timingSafeBytesEqual(derived, expected);
  } catch {
    return false;
  }
}
