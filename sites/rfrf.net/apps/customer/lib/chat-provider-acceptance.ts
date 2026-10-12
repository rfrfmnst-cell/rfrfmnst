import { AIChatRunStatus, prisma } from '@rafraf/db';
import {
  CHAT_ABUSE_LIMITS,
  CHAT_GLOBAL_RESERVATION_LOCK,
} from './chat-abuse-policy.ts';

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

export type ChatProviderAcceptanceResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'duplicate_request'
        | 'global_hourly_requests'
        | 'global_daily_requests';
      retryAfterSeconds: number;
    };

export interface ChatGlobalAcceptanceTransaction {
  canAccept(runId: string, now: Date): Promise<boolean>;
  countAccepted(since: Date): Promise<number>;
  accept(runId: string, acceptedAt: Date): Promise<boolean>;
  reject(
    runId: string,
    reason: 'global_hourly_requests' | 'global_daily_requests',
    now: Date,
  ): Promise<boolean>;
}

export interface ChatGlobalAcceptanceLedger {
  withGlobalLock<T>(
    operation: (transaction: ChatGlobalAcceptanceTransaction) => Promise<T>,
  ): Promise<T>;
}

function retryAfterSeconds(window: 'hour' | 'day'): number {
  return Math.ceil((window === 'hour' ? HOUR_MS : DAY_MS) / 1_000);
}

/**
 * Serializes the final provider-admission boundary. Rejected reservations and
 * requests that fail local validation never consume the global spend quota.
 */
export async function reserveGlobalChatProviderAcceptance(
  ledger: ChatGlobalAcceptanceLedger,
  input: { runId: string; now?: Date },
): Promise<ChatProviderAcceptanceResult> {
  const now = input.now ?? new Date();
  const hourStart = new Date(now.getTime() - HOUR_MS);
  const dayStart = new Date(now.getTime() - DAY_MS);
  return ledger.withGlobalLock(async (transaction) => {
    if (!(await transaction.canAccept(input.runId, now))) {
      return {
        ok: false,
        reason: 'duplicate_request',
        retryAfterSeconds: 1,
      };
    }
    const [globalHourly, globalDaily] = await Promise.all([
      transaction.countAccepted(hourStart),
      transaction.countAccepted(dayStart),
    ]);
    const rejectedReason =
      globalHourly >= CHAT_ABUSE_LIMITS.globalHourlyRequests
        ? ('global_hourly_requests' as const)
        : globalDaily >= CHAT_ABUSE_LIMITS.globalDailyRequests
          ? ('global_daily_requests' as const)
          : null;
    if (rejectedReason) {
      if (!(await transaction.reject(input.runId, rejectedReason, now))) {
        return {
          ok: false,
          reason: 'duplicate_request',
          retryAfterSeconds: 1,
        };
      }
      return {
        ok: false,
        reason: rejectedReason,
        retryAfterSeconds: retryAfterSeconds(
          rejectedReason === 'global_hourly_requests' ? 'hour' : 'day',
        ),
      };
    }
    if (!(await transaction.accept(input.runId, now))) {
      return {
        ok: false,
        reason: 'duplicate_request',
        retryAfterSeconds: 1,
      };
    }
    return { ok: true };
  });
}

export async function acceptChatRunForProvider(
  runId: string,
  now = new Date(),
): Promise<ChatProviderAcceptanceResult> {
  return reserveGlobalChatProviderAcceptance(
    {
      withGlobalLock: (operation) =>
        prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${CHAT_GLOBAL_RESERVATION_LOCK}))`;
          return operation({
            canAccept: async (candidateRunId, candidateNow) =>
              (await tx.aIChatRun.count({
                where: {
                  id: candidateRunId,
                  status: AIChatRunStatus.ACTIVE,
                  providerAcceptedAt: null,
                  expiresAt: { gt: candidateNow },
                },
              })) === 1,
            countAccepted: (since) =>
              tx.aIChatRun.count({
                where: { providerAcceptedAt: { gte: since } },
              }),
            accept: async (candidateRunId, acceptedAt) =>
              (
                await tx.aIChatRun.updateMany({
                  where: {
                    id: candidateRunId,
                    status: AIChatRunStatus.ACTIVE,
                    providerAcceptedAt: null,
                    expiresAt: { gt: acceptedAt },
                  },
                  data: { providerAcceptedAt: acceptedAt },
                })
              ).count === 1,
            reject: async (candidateRunId, reason, rejectedAt) =>
              (
                await tx.aIChatRun.updateMany({
                  where: {
                    id: candidateRunId,
                    status: AIChatRunStatus.ACTIVE,
                    providerAcceptedAt: null,
                  },
                  data: {
                    status: AIChatRunStatus.FAILED,
                    blockReason: reason,
                    finishedAt: rejectedAt,
                  },
                })
              ).count === 1,
          });
        }),
    },
    { runId, now },
  );
}
