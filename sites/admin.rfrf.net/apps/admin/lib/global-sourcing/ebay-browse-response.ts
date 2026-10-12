import { EbayBrowseDiscoveryError } from './ebay-browse-errors.ts';

const MAX_PROVIDER_BODY_BYTES = 1_000_000;

export async function parseBoundedJson(response: Response): Promise<unknown> {
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
      // The response is rejected regardless of transport cancellation outcome.
    }
    throw new EbayBrowseDiscoveryError('EBAY_RESPONSE_INVALID', false);
  }

  if (!response.body) {
    throw new EbayBrowseDiscoveryError('EBAY_RESPONSE_INVALID', false);
  }

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
          await reader.cancel('EBAY_RESPONSE_TOO_LARGE');
        } catch {
          // The size violation remains authoritative if cancellation fails.
        }
        throw new EbayBrowseDiscoveryError('EBAY_RESPONSE_INVALID', false);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof EbayBrowseDiscoveryError) throw error;
    try {
      await reader.cancel('EBAY_RESPONSE_READ_FAILED');
    } catch {
      // Normalize provider stream failures below.
    }
    throw new EbayBrowseDiscoveryError('EBAY_RESPONSE_INVALID', false);
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
    const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(body) as unknown;
  } catch {
    throw new EbayBrowseDiscoveryError('EBAY_RESPONSE_INVALID', false);
  }
}

export function errorForStatus(status: number): EbayBrowseDiscoveryError {
  if (status === 429) {
    return new EbayBrowseDiscoveryError('EBAY_RATE_LIMITED', true);
  }
  if (status === 401 || status === 403) {
    return new EbayBrowseDiscoveryError('EBAY_AUTH_FAILED', false);
  }
  if (status >= 400 && status < 500) {
    return new EbayBrowseDiscoveryError('EBAY_REQUEST_REJECTED', false);
  }
  return new EbayBrowseDiscoveryError('EBAY_UNAVAILABLE', true);
}
