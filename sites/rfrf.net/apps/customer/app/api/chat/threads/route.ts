import { NextResponse } from 'next/server';
import {
  ChatThreadLimitError,
  createOwnedThread,
  listOwnedThreads,
  validChatCursor,
} from '../../../../lib/chat-store';
import { getSessionCustomerId } from '../../../../lib/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const customerId = await getSessionCustomerId();
  if (!customerId)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const cursor = new URL(request.url).searchParams.get('cursor');
  if (cursor && !validChatCursor(cursor)) {
    return NextResponse.json({ error: 'invalid_cursor' }, { status: 400 });
  }
  return NextResponse.json(
    await listOwnedThreads(customerId, cursor ?? undefined),
  );
}

export async function POST(request: Request) {
  const customerId = await getSessionCustomerId();
  if (!customerId)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let title = 'محادثة جديدة';
  try {
    title = String(
      ((await request.json()) as { title?: unknown }).title ?? title,
    );
  } catch {
    /* optional body */
  }
  try {
    return NextResponse.json(
      { thread: await createOwnedThread(customerId, title) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ChatThreadLimitError) {
      return NextResponse.json({ error: 'thread_limit' }, { status: 409 });
    }
    throw error;
  }
}
