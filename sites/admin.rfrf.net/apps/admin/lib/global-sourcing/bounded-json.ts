/**
 * Reads a provider JSON body without buffering more than `maxBytes`. Any body
 * that is too large, cannot be read or is not UTF-8 JSON throws `invalid()`.
 * When `signal` aborts, the read is cancelled and `timedOut()` is thrown, so a
 * stalled body cannot outlive the caller's deadline.
 */
export async function readBoundedJson(
  response: Response,
  maxBytes: number,
  invalid: () => Error,
  options: { signal?: AbortSignal; timedOut?: () => Error } = {},
): Promise<unknown> {
  const { signal, timedOut = invalid } = options;
  const failure = () => (signal?.aborted ? timedOut() : invalid());
  const contentLength = response.headers.get('content-length');
  const declaredLength = contentLength === null ? null : Number(contentLength);
  if (
    declaredLength !== null &&
    Number.isFinite(declaredLength) &&
    declaredLength > maxBytes
  ) {
    try {
      await response.body?.cancel();
    } catch {
      // Size rejection remains authoritative if cancellation fails.
    }
    throw invalid();
  }
  if (!response.body) throw invalid();
  if (signal?.aborted) {
    try {
      await response.body.cancel();
    } catch {
      // The deadline has passed either way.
    }
    throw timedOut();
  }

  const reader = response.body.getReader();
  const onAbort = () => {
    reader.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel('RESPONSE_TOO_LARGE');
        } catch {
          // The response is rejected regardless of transport cancellation.
        }
        throw invalid();
      }
      chunks.push(value);
    }
  } catch {
    try {
      await reader.cancel('RESPONSE_READ_FAILED');
    } catch {
      // Normalize stream failures below.
    }
    throw failure();
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
  // A cancelled read may end as if the body were complete.
  if (signal?.aborted) throw timedOut();

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw invalid();
  }
}
