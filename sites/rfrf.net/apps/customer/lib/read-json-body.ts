export type BoundedJsonBodyResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: 'invalid_request' | 'too_large' };

async function cancelQuietly(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The size boundary has already been enforced; cancellation is best effort.
  }
}

export async function readBoundedJsonBody(
  request: Request,
  maxBytes: number,
): Promise<BoundedJsonBodyResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError('maxBytes must be a positive safe integer');
  }

  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const declaredBytes = Number(declaredLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
      return { ok: false, error: 'invalid_request' };
    }
    if (declaredBytes > maxBytes) {
      return { ok: false, error: 'too_large' };
    }
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, error: 'invalid_request' };

  const body = new Uint8Array(maxBytes);
  let receivedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value.byteLength > maxBytes - receivedBytes) {
        await cancelQuietly(reader);
        return { ok: false, error: 'too_large' };
      }
      body.set(value, receivedBytes);
      receivedBytes += value.byteLength;
    }
  } catch {
    await cancelQuietly(reader);
    return { ok: false, error: 'invalid_request' };
  }

  try {
    const value: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        body.subarray(0, receivedBytes),
      ),
    );
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { ok: false, error: 'invalid_request' };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false, error: 'invalid_request' };
  }
}
