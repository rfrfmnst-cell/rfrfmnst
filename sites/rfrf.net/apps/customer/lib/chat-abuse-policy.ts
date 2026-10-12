import { AIChatRunStatus, prisma } from '@rafraf/db';
import type { UIMessage } from 'ai';
import { opaqueRequestSubject, requestIpSubject } from './request-subject.ts';

/**
 * Hard ceilings are deliberately code-owned. Environment variables may not
 * raise provider spend or concurrency without a reviewed code change.
 */
export const CHAT_ABUSE_LIMITS = Object.freeze({
  customerHourlyRequests: 12,
  customerDailyRequests: 40,
  ipHourlyRequests: 30,
  ipDailyRequests: 120,
  globalHourlyRequests: 1_000,
  globalDailyRequests: 10_000,
  customerConcurrentRuns: 1,
  globalConcurrentRuns: 24,
  reservationSeconds: 75,
  latestUserTextChars: 4_000,
  modelContextMessages: 16,
  modelContextTextChars: 32_000,
  maxRecordedTokens: 1_000_000,
} as const);

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
export const CHAT_GLOBAL_RESERVATION_LOCK = 'ai-chat-reservation:global';
const SAFE_PROVIDER_OR_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;

type HeaderReader = { get(name: string): string | null };

export type ChatAbuseBlockReason =
  | 'duplicate_request'
  | 'customer_concurrency'
  | 'global_concurrency'
  | 'customer_hourly_requests'
  | 'customer_daily_requests'
  | 'ip_hourly_requests'
  | 'ip_daily_requests'
  | 'global_hourly_requests'
  | 'global_daily_requests';

export type ChatRunReservationResult =
  | { ok: true; runId: string; expiresAt: Date }
  | {
      ok: false;
      reason: ChatAbuseBlockReason;
      retryAfterSeconds: number;
    };

export interface ReserveChatRunInput {
  customerId: string;
  threadId: string;
  messageId: string;
  attemptId: string;
  headers: HeaderReader;
  provider: string;
  model: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

export interface ChatTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export class ChatAbuseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatAbuseConfigurationError';
  }
}

const CHAT_ATTEMPT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isChatAttemptId(value: unknown): value is string {
  return typeof value === 'string' && CHAT_ATTEMPT_ID_PATTERN.test(value);
}

function safeModelDimension(value: string, label: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 160 ||
    !SAFE_PROVIDER_OR_MODEL.test(normalized)
  ) {
    throw new ChatAbuseConfigurationError(
      `AI ${label} is not safe to persist as an abuse-control dimension`,
    );
  }
  return normalized;
}

function textChars(message: Pick<UIMessage, 'parts'>): number {
  return message.parts.reduce(
    (sum, part) => sum + (part.type === 'text' ? part.text.length : 0),
    0,
  );
}

export function latestUserTextWithinLimit(
  message: Pick<UIMessage, 'role' | 'parts'>,
): boolean {
  return (
    message.role !== 'user' ||
    textChars(message) <= CHAT_ABUSE_LIMITS.latestUserTextChars
  );
}

/**
 * Returns a contiguous, authoritative suffix. It never truncates message text
 * or synthesizes summaries, so tool approvals and ownership context retain
 * their original meaning while provider input stays bounded.
 */
export function boundAuthoritativeModelContext<T extends UIMessage>(
  messages: T[],
): T[] {
  const bounded: T[] = [];
  let usedTextChars = 0;

  for (
    let index = messages.length - 1;
    index >= 0 && bounded.length < CHAT_ABUSE_LIMITS.modelContextMessages;
    index -= 1
  ) {
    const message = messages[index];
    if (!message) break;
    const candidateTextChars = textChars(message);
    if (
      usedTextChars + candidateTextChars >
      CHAT_ABUSE_LIMITS.modelContextTextChars
    ) {
      break;
    }
    bounded.unshift(message);
    usedTextChars += candidateTextChars;
  }

  const firstUserIndex = bounded.findIndex(
    (message) => message.role === 'user',
  );
  return firstUserIndex > 0 ? bounded.slice(firstUserIndex) : bounded;
}

function boundedTokenCount(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0)
    return undefined;
  return Math.min(Math.floor(value), CHAT_ABUSE_LIMITS.maxRecordedTokens);
}

export function boundedChatTokenUsage(usage: ChatTokenUsage = {}): {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
} {
  return {
    inputTokens: boundedTokenCount(usage.inputTokens),
    outputTokens: boundedTokenCount(usage.outputTokens),
    totalTokens: boundedTokenCount(usage.totalTokens),
  };
}

function retryAfterSeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1_000));
}

function requestWindowRetryAfter(window: 'hour' | 'day'): number {
  // Counts use rolling windows. Waiting the complete window avoids telling a
  // client to retry at a wall-clock boundary while older runs still count.
  return retryAfterSeconds(window === 'hour' ? HOUR_MS : DAY_MS);
}

/**
 * Reserves quota and concurrency durably before the provider is called.
 * Global/customer/IP advisory locks make the count-and-create decision atomic
 * across concurrent serverless instances.
 */
export async function reserveChatRun(
  input: ReserveChatRunInput,
): Promise<ChatRunReservationResult> {
  const env = input.env ?? process.env;
  const ipHash = requestIpSubject(input.headers, env);
  const requestKey = opaqueRequestSubject(
    'ai-chat-request',
    `${input.customerId}:${input.threadId}:${input.messageId}:${input.attemptId}`,
    env,
  );
  if (!ipHash || !requestKey) {
    throw new ChatAbuseConfigurationError(
      'SESSION_SECRET is required for opaque AI abuse-control subjects',
    );
  }

  const provider = safeModelDimension(input.provider, 'provider');
  const model = safeModelDimension(input.model, 'model');
  const now = input.now ?? new Date();
  const hourStart = new Date(now.getTime() - HOUR_MS);
  const dayStart = new Date(now.getTime() - DAY_MS);
  const expiresAt = new Date(
    now.getTime() + CHAT_ABUSE_LIMITS.reservationSeconds * 1_000,
  );

  return prisma.$transaction(async (tx) => {
    const tryLock = async (key: string): Promise<boolean> => {
      const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS "locked"
      `;
      return rows[0]?.locked === true;
    };
    const rejectAttempt = async (
      reason: ChatAbuseBlockReason,
      retryAfter: number,
    ): Promise<ChatRunReservationResult> => {
      await tx.aIChatRun.create({
        data: {
          customerId: input.customerId,
          threadId: input.threadId,
          requestKey,
          ipHash,
          status: AIChatRunStatus.FAILED,
          blockReason: reason,
          provider,
          model,
          expiresAt: now,
          finishedAt: now,
        },
        select: { id: true },
      });
      return { ok: false, reason, retryAfterSeconds: retryAfter };
    };

    // Contended abusive callers fail immediately instead of occupying the DB
    // pool while waiting. Local scopes are always evaluated before the global
    // provider-spend lock so one customer cannot serialize every customer.
    const customerLock = `ai-chat-reservation:customer:${input.customerId}`;
    if (!(await tryLock(customerLock))) {
      return {
        ok: false,
        reason: 'customer_concurrency',
        retryAfterSeconds: 1,
      };
    }
    const ipLock = `ai-chat-reservation:ip:${ipHash}`;
    if (!(await tryLock(ipLock))) {
      return {
        ok: false,
        reason: 'ip_hourly_requests',
        retryAfterSeconds: 1,
      };
    }

    await tx.aIChatRun.updateMany({
      where: {
        status: AIChatRunStatus.ACTIVE,
        expiresAt: { lte: now },
        OR: [{ customerId: input.customerId }, { ipHash }],
      },
      data: { status: AIChatRunStatus.EXPIRED, finishedAt: now },
    });

    const duplicate = await tx.aIChatRun.findUnique({
      where: { requestKey },
      select: { id: true, status: true, expiresAt: true },
    });
    if (duplicate) {
      return {
        ok: false,
        reason: 'duplicate_request',
        retryAfterSeconds:
          duplicate.status === AIChatRunStatus.ACTIVE
            ? retryAfterSeconds(
                Math.max(1_000, duplicate.expiresAt.getTime() - now.getTime()),
              )
            : 1,
      };
    }

    const [customerHourly, customerDaily, ipHourly, ipDaily, customerActive] =
      await Promise.all([
        tx.aIChatRun.count({
          where: {
            customerId: input.customerId,
            createdAt: { gte: hourStart },
          },
        }),
        tx.aIChatRun.count({
          where: { customerId: input.customerId, createdAt: { gte: dayStart } },
        }),
        tx.aIChatRun.count({
          where: { ipHash, createdAt: { gte: hourStart } },
        }),
        tx.aIChatRun.count({
          where: { ipHash, createdAt: { gte: dayStart } },
        }),
        tx.aIChatRun.count({
          where: {
            customerId: input.customerId,
            status: AIChatRunStatus.ACTIVE,
            expiresAt: { gt: now },
          },
        }),
      ]);

    if (customerHourly >= CHAT_ABUSE_LIMITS.customerHourlyRequests) {
      return {
        ok: false,
        reason: 'customer_hourly_requests',
        retryAfterSeconds: requestWindowRetryAfter('hour'),
      };
    }
    if (customerDaily >= CHAT_ABUSE_LIMITS.customerDailyRequests) {
      return {
        ok: false,
        reason: 'customer_daily_requests',
        retryAfterSeconds: requestWindowRetryAfter('day'),
      };
    }
    if (ipHourly >= CHAT_ABUSE_LIMITS.ipHourlyRequests) {
      return {
        ok: false,
        reason: 'ip_hourly_requests',
        retryAfterSeconds: requestWindowRetryAfter('hour'),
      };
    }
    if (ipDaily >= CHAT_ABUSE_LIMITS.ipDailyRequests) {
      return {
        ok: false,
        reason: 'ip_daily_requests',
        retryAfterSeconds: requestWindowRetryAfter('day'),
      };
    }
    if (customerActive >= CHAT_ABUSE_LIMITS.customerConcurrentRuns) {
      return rejectAttempt(
        'customer_concurrency',
        CHAT_ABUSE_LIMITS.reservationSeconds,
      );
    }

    if (!(await tryLock(CHAT_GLOBAL_RESERVATION_LOCK))) {
      return rejectAttempt('global_concurrency', 1);
    }

    await tx.aIChatRun.updateMany({
      where: {
        status: AIChatRunStatus.ACTIVE,
        expiresAt: { lte: now },
      },
      data: { status: AIChatRunStatus.EXPIRED, finishedAt: now },
    });
    const globalActive = await tx.aIChatRun.count({
      where: {
        status: AIChatRunStatus.ACTIVE,
        expiresAt: { gt: now },
      },
    });
    if (globalActive >= CHAT_ABUSE_LIMITS.globalConcurrentRuns) {
      return rejectAttempt(
        'global_concurrency',
        CHAT_ABUSE_LIMITS.reservationSeconds,
      );
    }

    const run = await tx.aIChatRun.create({
      data: {
        customerId: input.customerId,
        threadId: input.threadId,
        requestKey,
        ipHash,
        blockReason: null,
        provider,
        model,
        expiresAt,
      },
      select: { id: true, expiresAt: true },
    });
    return { ok: true, runId: run.id, expiresAt: run.expiresAt };
  });
}

export async function finishChatRun(
  runId: string,
  status:
    | typeof AIChatRunStatus.COMPLETED
    | typeof AIChatRunStatus.FAILED
    | typeof AIChatRunStatus.ABORTED,
  usage: ChatTokenUsage = {},
): Promise<boolean> {
  const bounded = boundedChatTokenUsage(usage);
  const finished = await prisma.aIChatRun.updateMany({
    // A same-status callback may arrive later with final provider usage. It may
    // enrich the counters, but no terminal state can be changed or reopened.
    where: { id: runId, status: { in: [AIChatRunStatus.ACTIVE, status] } },
    data: {
      status,
      finishedAt: new Date(),
      inputTokens: bounded.inputTokens,
      outputTokens: bounded.outputTokens,
      totalTokens: bounded.totalTokens,
    },
  });
  return finished.count === 1;
}
