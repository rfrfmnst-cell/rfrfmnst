import {
  AIChatRunStatus,
  ChatMessageRole,
  ChatThreadStatus,
  Prisma,
  prisma,
} from '@rafraf/db';
import type { UIMessage } from 'ai';
import {
  withChatAttachmentMetadata,
  type ChatAttachmentMetadata,
} from './chat-attachment-metadata.ts';

const roleMap = {
  system: ChatMessageRole.SYSTEM,
  user: ChatMessageRole.USER,
  assistant: ChatMessageRole.ASSISTANT,
} as const;
export const MAX_THREAD_ATTACHMENTS = 2;
export const MAX_CUSTOMER_CHAT_ATTACHMENTS = 20;
export const MAX_ACTIVE_CHAT_THREADS = 20;
export const MAX_CUSTOMER_CHAT_THREADS = 50;
export const CHAT_THREAD_PAGE_SIZE = 20;
export const CHAT_MESSAGE_PAGE_SIZE = 40;
export const MAX_RETAINED_CHAT_MESSAGES_PER_THREAD = 200;

const CHAT_CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export class ChatThreadLimitError extends Error {
  constructor() {
    super('CHAT_THREAD_LIMIT');
    this.name = 'ChatThreadLimitError';
  }
}

function attachmentKeysFromDraft(draft: Prisma.JsonValue | null): string[] {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return [];
  const attachments = (draft as Record<string, unknown>).attachments;
  return Array.isArray(attachments)
    ? attachments.filter((value): value is string => typeof value === 'string')
    : [];
}

export function validChatCursor(value: unknown): value is string {
  return typeof value === 'string' && CHAT_CURSOR_PATTERN.test(value);
}

export async function listOwnedThreads(
  customerId: string,
  cursor?: string,
  client: typeof prisma = prisma,
) {
  const cursorThread = cursor
    ? await client.chatThread.findFirst({
        where: {
          id: cursor,
          customerId,
          status: ChatThreadStatus.ACTIVE,
        },
        select: { id: true, updatedAt: true },
      })
    : null;
  if (cursor && !cursorThread) return { threads: [], nextCursor: null };

  const rows = await client.chatThread.findMany({
    where: {
      customerId,
      status: ChatThreadStatus.ACTIVE,
      ...(cursorThread
        ? {
            OR: [
              { updatedAt: { lt: cursorThread.updatedAt } },
              {
                updatedAt: cursorThread.updatedAt,
                id: { lt: cursorThread.id },
              },
            ],
          }
        : {}),
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      title: true,
      rfqId: true,
      createdAt: true,
      updatedAt: true,
    },
    take: CHAT_THREAD_PAGE_SIZE + 1,
  });
  const threads = rows.slice(0, CHAT_THREAD_PAGE_SIZE);
  return {
    threads,
    nextCursor:
      rows.length > CHAT_THREAD_PAGE_SIZE ? (threads.at(-1)?.id ?? null) : null,
  };
}

export async function createOwnedThread(
  customerId: string,
  title = 'محادثة جديدة',
  client: typeof prisma = prisma,
) {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat-customer:${customerId}`}))`;
    const [activeCount, totalCount] = await Promise.all([
      tx.chatThread.count({
        where: { customerId, status: ChatThreadStatus.ACTIVE },
      }),
      tx.chatThread.count({ where: { customerId } }),
    ]);
    if (
      activeCount >= MAX_ACTIVE_CHAT_THREADS ||
      totalCount >= MAX_CUSTOMER_CHAT_THREADS
    ) {
      throw new ChatThreadLimitError();
    }
    return tx.chatThread.create({
      data: {
        customerId,
        title: title.trim().slice(0, 80) || 'محادثة جديدة',
        draft: {},
      },
      select: {
        id: true,
        title: true,
        rfqId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });
}

export async function getOwnedThread(customerId: string, threadId: string) {
  return prisma.chatThread.findFirst({
    where: { id: threadId, customerId, status: ChatThreadStatus.ACTIVE },
  });
}

export async function deleteOwnedThread(
  customerId: string,
  threadId: string,
  client: typeof prisma = prisma,
) {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat-customer:${customerId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat-message-retention:${threadId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat-attachment:${threadId}`}))`;

    const thread = await tx.chatThread.findFirst({
      where: { id: threadId, customerId, status: ChatThreadStatus.ACTIVE },
      select: { id: true, draft: true },
    });
    if (!thread) return { status: 'not_found' as const };

    const running = await tx.aIChatRun.findFirst({
      where: {
        threadId,
        customerId,
        status: AIChatRunStatus.ACTIVE,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (running) return { status: 'busy' as const };

    // Photos sent with an RFQ are its evidence and outlive the conversation.
    const attachmentKeys = attachmentKeysFromDraft(thread.draft);
    const evidence = attachmentKeys.length
      ? await tx.rFQEvidence.findMany({
          where: { storageKey: { in: attachmentKeys } },
          select: { storageKey: true },
        })
      : [];
    const keptKeys = new Set(evidence.map((row) => row.storageKey));
    const removableKeys = attachmentKeys.filter((key) => !keptKeys.has(key));

    // Keys stay in the draft, and so in the photo quota, until their objects
    // are confirmed deleted (forgetDeletedThreadAttachments).
    await tx.chatThread.update({
      where: { id: thread.id },
      data: {
        status: ChatThreadStatus.ARCHIVED,
        archivedAt: new Date(),
      },
    });
    return {
      status: 'deleted' as const,
      attachmentKeys: removableKeys,
    };
  });
}

export const FORGET_ATTACHMENT_ATTEMPTS = 3;
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Drops keys whose objects were deleted from an archived thread's draft so
 * they leave the photo quota. Transient database failures are retried; if
 * every attempt fails the keys stay counted, which only over-counts.
 */
export async function forgetDeletedThreadAttachments(
  customerId: string,
  threadId: string,
  deletedKeys: string[],
  client: typeof prisma = prisma,
  wait: (ms: number) => Promise<void> = pause,
) {
  if (!deletedKeys.length) return;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await forgetOnce(customerId, threadId, new Set(deletedKeys), client);
      return;
    } catch (error) {
      if (attempt >= FORGET_ATTACHMENT_ATTEMPTS) throw error;
      await wait(200 * 2 ** (attempt - 1));
    }
  }
}

async function forgetOnce(
  customerId: string,
  threadId: string,
  deleted: Set<string>,
  client: typeof prisma,
) {
  await client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat-customer:${customerId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat-attachment:${threadId}`}))`;
    const thread = await tx.chatThread.findFirst({
      where: { id: threadId, customerId, status: ChatThreadStatus.ARCHIVED },
      select: { id: true, draft: true },
    });
    if (!thread) return;
    const attachments = attachmentKeysFromDraft(thread.draft);
    const remaining = attachments.filter((key) => !deleted.has(key));
    if (remaining.length === attachments.length) return;
    await tx.chatThread.update({
      where: { id: thread.id },
      data: {
        draft: {
          ...(thread.draft as Record<string, unknown>),
          attachments: remaining,
        } as Prisma.InputJsonValue,
      },
    });
  });
}

export async function loadOwnedThread(
  customerId: string,
  threadId: string,
  options: { before?: string } = {},
  client: typeof prisma = prisma,
) {
  const thread = await client.chatThread.findFirst({
    where: { id: threadId, customerId, status: ChatThreadStatus.ACTIVE },
  });
  if (!thread) return null;

  const cursorMessage = options.before
    ? await client.chatMessage.findUnique({
        where: {
          threadId_externalId: {
            threadId,
            externalId: options.before,
          },
        },
        select: { id: true, createdAt: true },
      })
    : null;
  const rows =
    options.before && !cursorMessage
      ? []
      : await client.chatMessage.findMany({
          where: {
            threadId,
            ...(cursorMessage
              ? {
                  OR: [
                    { createdAt: { lt: cursorMessage.createdAt } },
                    {
                      createdAt: cursorMessage.createdAt,
                      id: { lt: cursorMessage.id },
                    },
                  ],
                }
              : {}),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: CHAT_MESSAGE_PAGE_SIZE + 1,
        });
  const page = rows.slice(0, CHAT_MESSAGE_PAGE_SIZE);
  return {
    id: thread.id,
    title: thread.title,
    rfqId: thread.rfqId,
    draft: thread.draft,
    updatedAt: thread.updatedAt,
    olderCursor:
      rows.length > CHAT_MESSAGE_PAGE_SIZE
        ? (page.at(-1)?.externalId ?? null)
        : null,
    messages: page.reverse().map((message) => ({
      id: message.externalId,
      role: message.role.toLowerCase(),
      parts: message.parts,
      metadata: message.metadata ?? undefined,
    })) as UIMessage[],
  };
}

// Every chat tool executes on the server, so a tool part still waiting for
// its input or output when a run ends (aborted, timed out or failed) can never
// get a result. Approval requests are a different state and are kept.
const UNSETTLED_TOOL_STATES = new Set(['input-streaming', 'input-available']);

/** A run's messages without tool calls that can never be completed. */
export function settledRunMessages<T extends UIMessage>(messages: T[]): T[] {
  return messages.flatMap((message) => {
    const parts = message.parts.filter(
      (part) =>
        !(
          (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) &&
          'state' in part &&
          UNSETTLED_TOOL_STATES.has(String(part.state))
        ),
    );
    if (parts.length === message.parts.length) return [message];
    return parts.length ? [{ ...message, parts }] : [];
  });
}

/**
 * Stores messages by external id. A customer message is insert-only: when a
 * row with its id already exists in the thread (of any role, including rows
 * outside the loaded page) it is left unchanged and its id is returned.
 */
export async function persistUiMessages(
  threadId: string,
  messages: UIMessage[],
  client: typeof prisma = prisma,
): Promise<string[]> {
  if (!messages.length) return [];
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat-message-retention:${threadId}`}))`;
    const hadStoredUserMessage = Boolean(
      await tx.chatMessage.findFirst({
        where: { threadId, role: ChatMessageRole.USER },
        select: { id: true },
      }),
    );
    const userIds = messages
      .filter((message) => message.role === 'user' && message.id)
      .map((message) => message.id);
    const existingUserIds = new Set(
      userIds.length
        ? (
            await tx.chatMessage.findMany({
              where: { threadId, externalId: { in: userIds } },
              select: { externalId: true },
            })
          ).map((row) => row.externalId)
        : [],
    );
    for (const message of messages) {
      const role = roleMap[message.role as keyof typeof roleMap];
      if (!role || !message.id || existingUserIds.has(message.id)) continue;
      await tx.chatMessage.upsert({
        where: { threadId_externalId: { threadId, externalId: message.id } },
        update: {
          parts: message.parts as unknown as Prisma.InputJsonValue,
          metadata: (message.metadata ??
            Prisma.JsonNull) as Prisma.InputJsonValue,
        },
        create: {
          threadId,
          externalId: message.id,
          role,
          parts: message.parts as unknown as Prisma.InputJsonValue,
          metadata: (message.metadata ?? undefined) as
            Prisma.InputJsonValue | undefined,
        },
      });
    }
    const retainedMessages = await tx.chatMessage.findMany({
      where: { threadId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
      take: MAX_RETAINED_CHAT_MESSAGES_PER_THREAD,
    });
    if (retainedMessages.length === MAX_RETAINED_CHAT_MESSAGES_PER_THREAD) {
      await tx.chatMessage.deleteMany({
        where: {
          threadId,
          id: { notIn: retainedMessages.map((message) => message.id) },
        },
      });
    }
    const firstUserText = messages
      .find((message) => message.role === 'user')
      ?.parts.find((part) => part.type === 'text')?.text;
    await tx.chatThread.update({
      where: { id: threadId },
      data: {
        updatedAt: new Date(),
        ...(!hadStoredUserMessage && firstUserText
          ? { title: firstUserText.trim().slice(0, 80) }
          : {}),
      },
    });
    return userIds.filter((id) => existingUserIds.has(id));
  });
}

export async function mergeThreadDraft(
  customerId: string,
  threadId: string,
  patch: Record<string, string | string[]>,
) {
  const owned = await getOwnedThread(customerId, threadId);
  if (!owned) return null;
  const current =
    owned.draft &&
    typeof owned.draft === 'object' &&
    !Array.isArray(owned.draft)
      ? (owned.draft as Record<string, unknown>)
      : {};
  const draft = { ...current, ...patch };
  return prisma.chatThread.update({
    where: { id: threadId },
    data: { draft: draft as Prisma.InputJsonValue },
    select: { id: true, draft: true, rfqId: true },
  });
}

export async function appendOwnedThreadAttachment(
  customerId: string,
  threadId: string,
  storageKey: string,
  client: typeof prisma = prisma,
  metadata: ChatAttachmentMetadata = { imageKind: 'PART_PHOTO' },
) {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat-customer:${customerId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat-attachment:${threadId}`}))`;
    const thread = await tx.chatThread.findFirst({
      where: { id: threadId, customerId, status: ChatThreadStatus.ACTIVE },
      select: { id: true, draft: true },
    });
    if (!thread) return { status: 'not_found' as const };

    const attachments = attachmentKeysFromDraft(thread.draft);
    if (attachments.length >= MAX_THREAD_ATTACHMENTS) {
      return { status: 'limit' as const };
    }

    const customerThreads = await tx.chatThread.findMany({
      where: { customerId },
      select: { draft: true },
      take: MAX_CUSTOMER_CHAT_THREADS + 1,
    });
    if (customerThreads.length > MAX_CUSTOMER_CHAT_THREADS) {
      return { status: 'customer_limit' as const };
    }
    const customerAttachmentCount = customerThreads.reduce(
      (total, row) => total + attachmentKeysFromDraft(row.draft).length,
      0,
    );
    if (customerAttachmentCount >= MAX_CUSTOMER_CHAT_ATTACHMENTS) {
      return { status: 'customer_limit' as const };
    }

    const current =
      thread.draft &&
      typeof thread.draft === 'object' &&
      !Array.isArray(thread.draft)
        ? (thread.draft as Record<string, unknown>)
        : {};
    await tx.chatThread.update({
      where: { id: thread.id },
      data: {
        draft: {
          ...current,
          attachments: [...attachments, storageKey],
          attachmentMetadata: withChatAttachmentMetadata(
            current,
            storageKey,
            metadata,
          ),
        } as Prisma.InputJsonValue,
      },
    });
    return { status: 'appended' as const };
  });
}
