import { randomUUID } from 'node:crypto';
import {
  detectEvidenceImage,
  EVIDENCE_MAX_BYTES,
  isEvidenceStorageKey,
} from '@rafraf/shared/evidence-image';
import { requestOriginAllowed } from '@rafraf/shared/public-origin';
import { NextResponse, type NextRequest } from 'next/server';
import { mediaTypeForChatAttachmentKey } from '../../../../lib/chat-image-parts';
import {
  appendOwnedThreadAttachment,
  getOwnedThread,
} from '../../../../lib/chat-store';
import {
  deletePrivateEvidence,
  getPrivateEvidence,
  putPrivateEvidence,
} from '../../../../lib/evidence-storage';
import { getSessionCustomerId } from '../../../../lib/session';
import { chatAttachmentMetadata } from '../../../../lib/chat-attachment-metadata';

export const dynamic = 'force-dynamic';
const MAX_MULTIPART_BYTES = EVIDENCE_MAX_BYTES + 512 * 1024;
const THREAD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

async function cleanupUploadedEvidence(storageKey: string) {
  try {
    await deletePrivateEvidence(storageKey);
  } catch {
    // The request must still fail closed if best-effort object cleanup fails.
  }
}

export async function POST(request: NextRequest) {
  const customerId = await getSessionCustomerId();
  if (!customerId)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (
    !requestOriginAllowed(
      request.headers.get('origin'),
      process.env.CUSTOMER_PUBLIC_URL,
      request.url,
    )
  )
    return NextResponse.json({ error: 'origin' }, { status: 403 });

  const contentType = request.headers.get('content-type') ?? '';
  const contentLength = Number(request.headers.get('content-length'));
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    return NextResponse.json(
      { error: 'invalid_content_type' },
      { status: 415 },
    );
  }
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    return NextResponse.json(
      { error: 'content_length_required' },
      { status: 411 },
    );
  }
  if (contentLength > MAX_MULTIPART_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }

  let data: FormData;
  try {
    data = await request.formData();
  } catch {
    return NextResponse.json({ error: 'invalid_attachment' }, { status: 400 });
  }
  const files = data.getAll('file');
  const file = files.length === 1 ? files[0] : null;
  const threadId = String(data.get('threadId') ?? '');
  const metadata = chatAttachmentMetadata({
    imageKind: data.get('imageKind') ?? 'PART_PHOTO',
    description: data.get('description') ?? undefined,
  });
  if (
    !metadata ||
    data.getAll('imageKind').length > 1 ||
    data.getAll('description').length > 1 ||
    !THREAD_ID_PATTERN.test(threadId) ||
    !(file instanceof File) ||
    file.size <= 0 ||
    file.size > EVIDENCE_MAX_BYTES
  ) {
    return NextResponse.json({ error: 'invalid_attachment' }, { status: 400 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectEvidenceImage(bytes);
  if (!detected || detected.contentType !== file.type) {
    return NextResponse.json({ error: 'invalid_attachment' }, { status: 400 });
  }
  const thread = await getOwnedThread(customerId, threadId);
  if (!thread)
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const current =
    thread.draft &&
    typeof thread.draft === 'object' &&
    !Array.isArray(thread.draft)
      ? (thread.draft as Record<string, unknown>)
      : {};
  const attachments = Array.isArray(current.attachments)
    ? current.attachments.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
  if (attachments.length >= 2)
    return NextResponse.json({ error: 'attachment_limit' }, { status: 409 });
  const key = `${customerId}/${threadId}/${randomUUID()}.${detected.extension}`;
  try {
    await putPrivateEvidence(key, bytes, detected.contentType);
  } catch {
    return NextResponse.json(
      { error: 'attachment_storage_unavailable' },
      { status: 503 },
    );
  }

  let appendResult: Awaited<ReturnType<typeof appendOwnedThreadAttachment>>;
  try {
    appendResult = await appendOwnedThreadAttachment(
      customerId,
      threadId,
      key,
      undefined,
      metadata,
    );
  } catch {
    await cleanupUploadedEvidence(key);
    return NextResponse.json(
      { error: 'attachment_persistence_failed' },
      { status: 503 },
    );
  }
  if (appendResult.status !== 'appended') {
    await cleanupUploadedEvidence(key);
    return NextResponse.json(
      {
        error:
          appendResult.status === 'limit'
            ? 'attachment_limit'
            : appendResult.status === 'customer_limit'
              ? 'customer_attachment_limit'
              : 'not_found',
      },
      { status: appendResult.status === 'not_found' ? 404 : 409 },
    );
  }

  return NextResponse.json(
    {
      key,
      mediaType: detected.contentType,
      url: `/api/chat/attachments?key=${encodeURIComponent(key)}`,
    },
    { status: 201 },
  );
}

export async function GET(request: NextRequest) {
  const customerId = await getSessionCustomerId();
  if (!customerId)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const key = request.nextUrl.searchParams.get('key') ?? '';
  if (!key.startsWith(`${customerId}/`) || !isEvidenceStorageKey(key)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const [, threadId] = key.split('/');
  if (!threadId || !(await getOwnedThread(customerId, threadId))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    const bytes = await getPrivateEvidence(key);
    const contentType = mediaTypeForChatAttachmentKey(key);
    if (
      !contentType ||
      bytes.length === 0 ||
      bytes.length > EVIDENCE_MAX_BYTES ||
      detectEvidenceImage(bytes)?.contentType !== contentType
    ) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return new NextResponse(bytes, {
      headers: {
        'content-type': contentType,
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
}
