import { AIChatRunStatus, prisma } from '@rafraf/db';
import {
  CHAT_ABUSE_LIMITS,
  finishChatRun,
  type ChatTokenUsage,
} from './chat-abuse-policy.ts';

// Lifecycle of one reserved model run: its deadline, its usage, and the lease
// that keeps its reservation until it is released.

/**
 * Token usage of a model run. An aborted stream never receives its final
 * total, so the steps that did finish are summed instead of recording
 * nothing; a field stays undefined only when no step reports it.
 */
export function chatRunUsage(
  steps: ReadonlyArray<{ usage: ChatTokenUsage }>,
  total: ChatTokenUsage = {},
): ChatTokenUsage {
  if (
    total.inputTokens !== undefined ||
    total.outputTokens !== undefined ||
    total.totalTokens !== undefined
  ) {
    return {
      inputTokens: total.inputTokens,
      outputTokens: total.outputTokens,
      totalTokens: total.totalTokens,
    };
  }
  const sum = (key: keyof ChatTokenUsage) => {
    const values = steps
      .map((step) => step.usage[key])
      .filter((value): value is number => typeof value === 'number');
    return values.length ? values.reduce((a, b) => a + b, 0) : undefined;
  };
  return {
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    totalTokens: sum('totalTokens'),
  };
}

/** Left for the run's end callback to record usage before the lease lapses. */
const CHAT_RUN_SETTLE_MS = 5_000;

/**
 * Total timeout for a model run. Self-hosted Node does not enforce the
 * route's maxDuration, and the reservation started before the pre-stream
 * work, so the run is bounded by both: a later request can never expire a
 * live run or lose its usage.
 */
export function chatRunTimeoutMs(
  expiresAt: Date,
  maxDurationSeconds: number,
  now = Date.now(),
): number {
  return Math.max(
    1,
    Math.min(
      maxDurationSeconds * 1_000,
      expiresAt.getTime() - now - CHAT_RUN_SETTLE_MS,
    ),
  );
}

/** A live run renews its lease well inside reservationSeconds. */
export const CHAT_RUN_HEARTBEAT_MS = 20_000;
/** No run is held longer than this, even if a release is somehow missed. */
export const CHAT_RUN_MAX_HOLD_MS = 5 * 60_000;

/**
 * Renews the lease of a run that is still ACTIVE and not yet expired, so an
 * expired or finished run is never reopened.
 */
export async function renewChatRun(
  runId: string,
  now = new Date(),
): Promise<boolean> {
  const renewed = await prisma.aIChatRun.updateMany({
    where: {
      id: runId,
      status: AIChatRunStatus.ACTIVE,
      expiresAt: { gt: now },
    },
    data: {
      expiresAt: new Date(
        now.getTime() + CHAT_ABUSE_LIMITS.reservationSeconds * 1_000,
      ),
    },
  });
  return renewed.count === 1;
}

type ChatRunTerminalStatus =
  | typeof AIChatRunStatus.COMPLETED
  | typeof AIChatRunStatus.FAILED
  | typeof AIChatRunStatus.ABORTED;

/**
 * Holds a reservation while its run is alive. The model is cut at its
 * deadline, but a tool that ignores cancellation is still awaited, so the
 * lease is renewed until release and a retry is never admitted beside it.
 * The returned release stops renewing and may be called more than once.
 */
export function holdChatRun(
  runId: string,
  usage: () => ChatTokenUsage,
  { renew = renewChatRun, finish = finishChatRun } = {},
) {
  const startedAt = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - startedAt >= CHAT_RUN_MAX_HOLD_MS) {
      clearInterval(timer);
      return;
    }
    // Best effort: a missed renewal only lets the lease expire on its own.
    renew(runId).catch(() => undefined);
  }, CHAT_RUN_HEARTBEAT_MS);
  timer.unref?.();
  return async function release(
    status: ChatRunTerminalStatus,
    finalUsage: ChatTokenUsage = usage(),
  ) {
    clearInterval(timer);
    try {
      await finish(runId, status, finalUsage);
    } catch (error) {
      // The durable expiry releases a slot if this best-effort terminal
      // update is interrupted by a database outage.
      console.error('[chat] abuse-control release failed', {
        status,
        errorType: error instanceof Error ? error.name : 'unknown',
      });
    }
  };
}
