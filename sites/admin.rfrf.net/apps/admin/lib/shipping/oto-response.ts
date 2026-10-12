const MAX_PROVIDER_BODY_BYTES = 1_000_000;

export function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

export function safeFiniteNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const candidate = typeof value === 'string' ? value.trim() : value;
  if (candidate === '') return null;
  const number = Number(candidate);
  return Number.isFinite(number) && number >= minimum && number <= maximum
    ? number
    : null;
}

export function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Reads provider JSON with an explicit hard ceiling instead of buffering it. */
export async function parseBoundedJson(
  response: Response,
  invalidResponse: () => Error,
): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  const declaredLength = contentLength === null ? null : Number(contentLength);
  if (
    declaredLength !== null &&
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PROVIDER_BODY_BYTES
  ) {
    try {
      await response.body?.cancel();
    } catch {
      // Reject the response even if transport cancellation fails.
    }
    throw invalidResponse();
  }
  if (!response.body) throw invalidResponse();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_PROVIDER_BODY_BYTES) {
        try {
          await reader.cancel('OTO_RESPONSE_TOO_LARGE');
        } catch {
          // Reject the response even if transport cancellation fails.
        }
        throw invalidResponse();
      }
      chunks.push(value);
    }
  } catch {
    try {
      await reader.cancel('OTO_RESPONSE_READ_FAILED');
    } catch {
      // Normalize stream failures below.
    }
    throw invalidResponse();
  } finally {
    reader.releaseLock();
  }

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
    throw invalidResponse();
  }
}
