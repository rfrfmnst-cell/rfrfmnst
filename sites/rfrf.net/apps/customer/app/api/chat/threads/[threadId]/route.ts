import { NextResponse, type NextRequest } from 'next/server';
import { requestOriginAllowed } from '@rafraf/shared/public-origin';
import {
  deleteOwnedThread,
  forgetDeletedThreadAttachments,
  loadOwnedThread,
  validChatCursor,
} from '../../../../../lib/chat-store';
import { deletePrivateEvidence } from '../../../../../lib/evidence-storage';
import { getSessionCustomerId } from '../../../../../lib/session';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  const customerId = await getSessionCustomerId();
  if (!customerId)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { threadId } = await context.params;
  const before = new URL(request.url).searchParams.get('before');
  if (before && !validChatCursor(before)) {
    return NextResponse.json({ error: 'invalid_cursor' }, { status: 400 });
  }
  const thread = await loadOwnedThread(customerId, threadId, {
    before: before ?? undefined,
  });
  if (!thread)
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ thread });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ threadId: string }> },
) {
  const customerId = await getSessionCustomerId();
  if (!customerId)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (
    !requestOriginAllowed(
      request.headers.get('origin'),
      process.env.CUSTOMER_PUBLIC_URL,
      request.url,
    )
  ) {
    return NextResponse.json({ error: 'origin' }, { status: 403 });
  }

  const { threadId } = await context.params;
  const result = await deleteOwnedThread(customerId, threadId);
  if (result.status === 'not_found') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (result.status === 'busy') {
    return NextResponse.json({ error: 'thread_busy' }, { status: 409 });
  }

  const outcomes = await Promise.allSettled(
    result.attachmentKeys.map((key) => deletePrivateEvidence(key)),
  );
  const deletedKeys = result.attachmentKeys.filter(
    (_, index) => outcomes[index]?.status === 'fulfilled',
  );
  // A failed deletion keeps its key, so the photo still counts and can be found.
  try {
    await forgetDeletedThreadAttachments(customerId, threadId, deletedKeys);
  } catch (error) {
    console.error('[chat] deleted photos stay counted after cleanup failed', {
      errorType: error instanceof Error ? error.name : 'unknown',
    });
  }
  return new NextResponse(null, { status: 204 });
}
