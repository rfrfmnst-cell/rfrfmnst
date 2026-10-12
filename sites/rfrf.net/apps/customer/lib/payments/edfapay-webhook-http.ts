import type { NextRequest } from 'next/server';

const MAX_BODY_BYTES = 64_000;

export interface WebhookEnvelope {
  payload: Record<string, unknown>;
  rawBody: Uint8Array;
}

export function ok(): Response {
  return new Response('OK', {
    status: 200,
    headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
  });
}

/** يجعل المزوّد يعيد الإرسال لاحقاً بدل اعتبار الإشعار مستهلَكاً. */
export function retryLater(): Response {
  return new Response('ERROR', {
    status: 503,
    headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
  });
}

export function unauthorized(): Response {
  return new Response('UNAUTHORIZED', {
    status: 401,
    headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
  });
}

export async function readPayload(
  request: NextRequest,
): Promise<WebhookEnvelope | null> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY_BYTES) return null;

  const contentType = request.headers.get('content-type') ?? '';
  try {
    const reader = request.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder().decode(body);

    // Hosted Checkout v1 documents callbacks as text/plain even though the
    // body is JSON. Accept only those two explicit representations.
    if (
      contentType.includes('application/json') ||
      contentType.includes('text/plain')
    ) {
      const parsed: unknown = JSON.parse(text);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? { payload: parsed as Record<string, unknown>, rawBody: body }
        : null;
    }
    if (!contentType.includes('application/x-www-form-urlencoded')) {
      return null;
    }
    // EdfaPay يرسل الإشعار كنموذج URL-encoded في مسار Checkout.
    const form = new URLSearchParams(text);
    const payload: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) payload[key] = value;
    return { payload, rawBody: body };
  } catch {
    return null;
  }
}
